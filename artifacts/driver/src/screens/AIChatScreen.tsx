// ============================================================
// MCC Driver — AI Support Chat Screen
// ============================================================
// Full-featured chat interface with quick actions, conversation
// history, action confirmations, and typing indicators.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAIChat } from '@/hooks/useAIChat';
import { QUICK_ACTIONS } from '@/services/ai/aiOpsService';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';

export function AIChatScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const {
    messages, conversationId, isSending, error, lastActions, category,
    recentConversations, sendMessage, startNewConversation, loadHistory,
    loadExistingConversation,
  } = useAIChat(driver?.id || null);

  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  // Load conversation history on mount
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput('');
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const categoryIcons: Record<string, string> = {
    support: '💬', earnings: '💰', vehicle: '🚗',
    verification: '🪪', ride_issue: '⚠️', account: '⚙️',
    onboarding: '🎓',
  };

  const categoryLabels: Record<string, string> = {
    support: 'Support', earnings: 'Earnings', vehicle: 'Vehicles',
    verification: 'Verification', ride_issue: 'Ride Issue', account: 'Account',
    onboarding: 'Getting Started',
  };

  if (!driver) return null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: colors.bgPrimary }}>
      {/* Header */}
      <div style={{
        background: colors.navy, padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          onClick={() => navigate('/home')}
          style={{ background: 'none', border: 'none', color: colors.textWhite, fontSize: 22, cursor: 'pointer' }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: colors.textWhite }}>MCC Driver Support</div>
          <div style={{ fontSize: 11, color: colors.gold }}>
            AI-powered • {categoryIcons[category]} {categoryLabels[category]}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: borderRadius.sm,
              color: colors.textWhite, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
            }}
          >
            📋 History
          </button>
          <button
            onClick={startNewConversation}
            style={{
              background: 'rgba(201,152,46,0.2)', border: 'none', borderRadius: borderRadius.sm,
              color: colors.gold, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
            }}
          >
            + New
          </button>
        </div>
      </div>

      {/* Conversation history sidebar */}
      {showHistory && (
        <div style={{
          background: colors.bgCard, borderBottom: `1px solid ${colors.border}`,
          padding: 12, maxHeight: 200, overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
            Recent Conversations
          </div>
          {recentConversations.length === 0 ? (
            <div style={{ fontSize: 13, color: colors.textMuted, padding: 8 }}>No past conversations</div>
          ) : (
            recentConversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => { loadExistingConversation(conv.id); setShowHistory(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 10px', border: 'none',
                  background: conv.id === conversationId ? colors.bgSecondary : 'transparent',
                  borderRadius: borderRadius.sm, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span>{categoryIcons[conv.category] || '💬'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: colors.textPrimary }}>
                    {categoryLabels[conv.category] || 'Support'}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {new Date(conv.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 6px',
                  borderRadius: borderRadius.full,
                  background: conv.status === 'resolved' ? colors.successBg : conv.status === 'escalated' ? colors.warningBg : colors.bgSecondary,
                  color: conv.status === 'resolved' ? colors.success : conv.status === 'escalated' ? colors.warning : colors.textMuted,
                }}>
                  {conv.status}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="scroll-container"
        style={{ flex: 1, padding: 16, overflowY: 'auto' }}
      >
        {/* Welcome message if no messages */}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Hey {driver.firstName}!
            </div>
            <div style={{ fontSize: 14, color: colors.textMuted, maxWidth: 300, margin: '0 auto 24px' }}>
              I can help with earnings, payouts, adding vehicles, insurance, ride issues, and more. What do you need?
            </div>

            {/* Quick actions grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8, maxWidth: 360, margin: '0 auto',
            }}>
              {QUICK_ACTIONS.map(action => (
                <button
                  key={action.id}
                  onClick={() => handleQuickAction(action.prompt)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '12px 14px', border: `1px solid ${colors.border}`,
                    background: colors.bgCard, borderRadius: borderRadius.md,
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = colors.gold)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
                >
                  <span style={{ fontSize: 18 }}>{action.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: colors.textPrimary }}>
                    {action.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg, i) => (
          <div
            key={msg.id || i}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 12,
            }}
          >
            <div style={{
              maxWidth: '85%',
              padding: '12px 16px',
              borderRadius: msg.role === 'user'
                ? `${borderRadius.lg}px ${borderRadius.lg}px 4px ${borderRadius.lg}px`
                : `${borderRadius.lg}px ${borderRadius.lg}px ${borderRadius.lg}px 4px`,
              background: msg.role === 'user' ? colors.navy : colors.bgCard,
              color: msg.role === 'user' ? colors.textWhite : colors.textPrimary,
              border: msg.role === 'assistant' ? `1px solid ${colors.border}` : 'none',
              fontSize: 14, lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}

              {/* Show action results inline */}
              {msg.actionTaken && (
                <div style={{
                  marginTop: 8, paddingTop: 8,
                  borderTop: `1px solid ${msg.role === 'user' ? 'rgba(255,255,255,0.15)' : colors.borderLight}`,
                  fontSize: 12, fontWeight: 500,
                  color: msg.role === 'user' ? 'rgba(255,255,255,0.7)' : colors.success,
                }}>
                  ✓ {msg.actionTaken}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isSending && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
            <div style={{
              padding: '12px 20px', borderRadius: `${borderRadius.lg}px ${borderRadius.lg}px ${borderRadius.lg}px 4px`,
              background: colors.bgCard, border: `1px solid ${colors.border}`,
            }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 8, height: 8, borderRadius: '50%', background: colors.textMuted,
                    animation: `bounce 1s infinite ${i * 0.15}s`,
                  }} />
                ))}
              </div>
              <style>{`
                @keyframes bounce {
                  0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
                  30% { transform: translateY(-6px); opacity: 1; }
                }
              `}</style>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={{
            padding: 12, background: colors.errorBg, borderRadius: borderRadius.sm,
            color: colors.error, fontSize: 13, marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {/* Action results banner */}
        {lastActions.length > 0 && (
          <div style={{
            padding: 12, background: colors.successBg, borderRadius: borderRadius.md,
            marginBottom: 12,
          }}>
            {lastActions.map((action, i) => (
              <div key={i} style={{ fontSize: 13, color: colors.success, fontWeight: 500 }}>
                ✓ {action.result}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{
        padding: '12px 16px max(12px, env(safe-area-inset-bottom))',
        background: colors.bgCard, borderTop: `1px solid ${colors.border}`,
      }}>
        {/* Quick action chips (show after first message) */}
        {messages.length > 0 && messages.length < 3 && (
          <div style={{
            display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8,
            scrollbarWidth: 'none',
          }}>
            {QUICK_ACTIONS.slice(0, 4).map(action => (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action.prompt)}
                style={{
                  flexShrink: 0, padding: '6px 12px',
                  border: `1px solid ${colors.border}`,
                  background: colors.bgSecondary, borderRadius: borderRadius.full,
                  cursor: 'pointer', fontSize: 12, color: colors.textSecondary,
                  whiteSpace: 'nowrap',
                }}
              >
                {action.icon} {action.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            rows={1}
            style={{
              flex: 1, padding: '10px 14px', fontSize: 15,
              border: `1px solid ${colors.border}`, borderRadius: borderRadius.lg,
              background: colors.bgPrimary, color: colors.textPrimary,
              resize: 'none', outline: 'none', fontFamily: 'inherit',
              maxHeight: 120, minHeight: 40,
            }}
            onFocus={e => e.target.style.borderColor = colors.gold}
            onBlur={e => e.target.style.borderColor = colors.border}
            onInput={e => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            style={{
              width: 44, height: 44, borderRadius: '50%',
              border: 'none', cursor: input.trim() && !isSending ? 'pointer' : 'default',
              background: input.trim() ? colors.gold : colors.bgSecondary,
              color: input.trim() ? colors.navy : colors.textMuted,
              fontSize: 18, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
          >
            {isSending ? <Spinner size={18} /> : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}
