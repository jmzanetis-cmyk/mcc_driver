import React, { useRef, useEffect, useState } from 'react';
import { useTripChat } from '@/hooks/useTripChat';
import { colors, borderRadius } from '@/theme';

const QUICK_MESSAGES = [
  'On my way!',
  "I've arrived",
  'Running ~5 min late',
  'Please come outside',
];

interface TripChatProps {
  rideId: string;
  onClose: () => void;
}

export function TripChat({ rideId, onClose }: TripChatProps) {
  const { messages, sending, sendError, sendMessage } = useTripChat(rideId);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = async (body: string) => {
    if (!body.trim() || sending) return;
    setInput('');
    await sendMessage(body);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'rgba(0,0,0,0.4)',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed', left: 0, right: 0,
          bottom: 0, zIndex: 901,
          background: colors.bgCard,
          borderRadius: `${borderRadius.xl}px ${borderRadius.xl}px 0 0`,
          maxHeight: '70vh',
          display: 'flex', flexDirection: 'column',
          animation: 'slideUp 0.25s ease',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 12px',
          borderBottom: `1px solid ${colors.borderLight}`,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy }}>
            Trip Chat
          </div>
          <button
            onClick={onClose}
            aria-label="Close chat"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: colors.textMuted, fontSize: 22, lineHeight: 1,
              minWidth: 44, minHeight: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Message list */}
        <div
          ref={listRef}
          style={{
            flex: 1, overflowY: 'auto',
            padding: '12px 16px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: colors.textMuted, fontSize: 13, marginTop: 16 }}>
              No messages yet. Say hello!
            </div>
          )}
          {messages.map((msg) => {
            const isDriver = msg.senderRole === 'driver';
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  justifyContent: isDriver ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{
                  maxWidth: '75%',
                  padding: '10px 14px',
                  borderRadius: isDriver
                    ? `${borderRadius.md}px ${borderRadius.md}px 4px ${borderRadius.md}px`
                    : `${borderRadius.md}px ${borderRadius.md}px ${borderRadius.md}px 4px`,
                  background: isDriver ? colors.navy : colors.bgSecondary,
                  color: isDriver ? '#fff' : colors.textPrimary,
                  fontSize: 14,
                }}>
                  {!isDriver && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, marginBottom: 3, textTransform: 'uppercase' }}>
                      {msg.senderRole === 'system' ? 'System' : 'Member'}
                    </div>
                  )}
                  {msg.body}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick messages */}
        <div style={{
          padding: '8px 16px',
          display: 'flex', gap: 8, overflowX: 'auto',
          borderTop: `1px solid ${colors.borderLight}`,
        }}>
          {QUICK_MESSAGES.map((q) => (
            <button
              key={q}
              onClick={() => void handleSend(q)}
              disabled={sending}
              style={{
                flexShrink: 0, padding: '8px 14px',
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.full,
                background: colors.bgSecondary,
                color: colors.textPrimary, fontSize: 13,
                cursor: 'pointer', whiteSpace: 'nowrap',
                fontFamily: 'inherit',
                minHeight: 36,
              }}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input row */}
        <div style={{
          padding: '10px 16px 12px',
          display: 'flex', gap: 10, alignItems: 'flex-end',
        }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(input); } }}
            placeholder="Message the member…"
            maxLength={500}
            style={{
              flex: 1, padding: '12px 14px',
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              background: colors.bgSecondary, color: colors.textPrimary,
              fontSize: 15, outline: 'none', fontFamily: 'inherit',
              minHeight: 48,
            }}
          />
          <button
            onClick={() => void handleSend(input)}
            disabled={sending || !input.trim()}
            aria-label="Send message"
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: input.trim() ? colors.navy : colors.bgSecondary,
              border: 'none', color: '#fff', fontSize: 20,
              cursor: input.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'background 0.15s',
            }}
          >
            ↑
          </button>
        </div>

        {sendError && (
          <div style={{
            padding: '6px 16px 10px', fontSize: 12,
            color: colors.error, textAlign: 'center',
          }}>
            {sendError}
          </div>
        )}
      </div>
    </>
  );
}
