import { useState, useCallback, useRef } from 'react';
import {
  sendDriverMessage,
  loadConversation,
  loadRecentConversations,
  type AIMessage,
  type AIConversation,
  type AICategory,
  type ProposedAction,
} from '@/services/ai/aiOpsService';

interface ChatState {
  messages: AIMessage[];
  conversationId: string | null;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  proposedActions: ProposedAction[];
  category: AICategory;
}

export function useAIChat(driverId: string | null) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    conversationId: null,
    isLoading: false,
    isSending: false,
    error: null,
    proposedActions: [],
    category: 'support',
  });

  const [recentConversations, setRecentConversations] = useState<AIConversation[]>([]);
  const messageIdCounter = useRef(0);

  const sendMessage = useCallback(async (text: string) => {
    if (!driverId || !text.trim() || state.isSending) return;

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
      proposedActions: [],
    }));

    try {
      const result = await sendDriverMessage(
        driverId,
        state.conversationId,
        text.trim(),
        state.messages,
      );

      const assistantMsg: AIMessage = {
        id: `ai-${++messageIdCounter.current}`,
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString(),
        category: result.category,
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, assistantMsg],
        conversationId: result.conversationId,
        isSending: false,
        proposedActions: result.proposedActions,
        category: result.category,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get response';
      setState(prev => ({
        ...prev,
        isSending: false,
        error: message,
      }));
    }
  }, [driverId, state.conversationId, state.messages, state.isSending]);

  /** Confirm and execute AI-proposed actions after explicit driver approval. */
  const confirmActions = useCallback(async (actions: ProposedAction[]) => {
    if (!driverId || actions.length === 0) return;

    setState(prev => ({ ...prev, isSending: true, error: null }));

    try {
      const result = await sendDriverMessage(driverId, state.conversationId, '', [], actions);

      const confirmMsg: AIMessage = {
        id: `exec-${++messageIdCounter.current}`,
        role: 'assistant',
        content: result.executedActions.map(a => `✓ ${a.result}`).join('\n'),
        timestamp: new Date().toISOString(),
        actionTaken: result.executedActions.map(a => `${a.type}: ${a.result}`).join('; '),
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, confirmMsg],
        isSending: false,
        proposedActions: [],
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed';
      setState(prev => ({ ...prev, isSending: false, error: message }));
    }
  }, [driverId, state.conversationId]);

  /** Dismiss proposed actions without executing them. */
  const dismissActions = useCallback(() => {
    setState(prev => ({ ...prev, proposedActions: [] }));
  }, []);

  const loadExistingConversation = useCallback(async (conversationId: string) => {
    setState(prev => ({ ...prev, isLoading: true }));
    const messages = await loadConversation(conversationId);
    setState(prev => ({ ...prev, messages, conversationId, isLoading: false }));
  }, []);

  const startNewConversation = useCallback(() => {
    setState({
      messages: [],
      conversationId: null,
      isLoading: false,
      isSending: false,
      error: null,
      proposedActions: [],
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
    confirmActions,
    dismissActions,
    loadExistingConversation,
    startNewConversation,
    loadHistory,
  };
}
