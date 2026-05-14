// ============================================================
// MCC Driver — useAIChat Hook
// ============================================================

import { useState, useCallback, useRef } from 'react';
import {
  sendDriverMessage,
  loadConversation,
  loadRecentConversations,
  type AIMessage,
  type AIConversation,
  type AICategory,
} from '@/services/ai/aiOpsService';

interface ActionResult {
  type: string;
  result: string;
}

interface ChatState {
  messages: AIMessage[];
  conversationId: string | null;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  lastActions: ActionResult[];
  category: AICategory;
}

export function useAIChat(driverId: string | null) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    conversationId: null,
    isLoading: false,
    isSending: false,
    error: null,
    lastActions: [],
    category: 'support',
  });

  const [recentConversations, setRecentConversations] = useState<AIConversation[]>([]);
  const messageIdCounter = useRef(0);

  const sendMessage = useCallback(async (text: string) => {
    if (!driverId || !text.trim() || state.isSending) return;

    // Add user message immediately (optimistic)
    const userMsg: AIMessage = {
      id: `local-${++messageIdCounter.current}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMsg],
      isSending: true,
      error: null,
    }));

    try {
      const result = await sendDriverMessage(
        driverId,
        state.conversationId,
        text.trim(),
        state.messages, // pass conversation history
      );

      const assistantMsg: AIMessage = {
        id: `ai-${++messageIdCounter.current}`,
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString(),
        category: result.category,
        actionTaken: result.actions.length > 0
          ? result.actions.map(a => `${a.type}: ${a.result}`).join('; ')
          : undefined,
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, assistantMsg],
        conversationId: result.conversationId,
        isSending: false,
        lastActions: result.actions,
        category: result.category,
      }));
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        isSending: false,
        error: err.message || 'Failed to get response',
      }));
    }
  }, [driverId, state.conversationId, state.messages, state.isSending]);

  const loadExistingConversation = useCallback(async (conversationId: string) => {
    setState(prev => ({ ...prev, isLoading: true }));

    const messages = await loadConversation(conversationId);
    setState(prev => ({
      ...prev,
      messages,
      conversationId,
      isLoading: false,
    }));
  }, []);

  const startNewConversation = useCallback(() => {
    setState({
      messages: [],
      conversationId: null,
      isLoading: false,
      isSending: false,
      error: null,
      lastActions: [],
      category: 'support',
    });
  }, []);

  const loadHistory = useCallback(async () => {
    if (!driverId) return;
    const conversations = await loadRecentConversations(driverId);
    setRecentConversations(conversations);
  }, [driverId]);

  return {
    ...state,
    recentConversations,
    sendMessage,
    loadExistingConversation,
    startNewConversation,
    loadHistory,
  };
}
