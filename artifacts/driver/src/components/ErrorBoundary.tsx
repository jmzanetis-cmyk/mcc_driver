import React from 'react';
import { colors } from '@/theme';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.surfaceDark,
            padding: 32,
            gap: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: colors.textWhite, textAlign: 'center' }}>
            Something went wrong
          </div>
          <div style={{ fontSize: 14, color: 'rgba(250,247,240,0.6)', textAlign: 'center', maxWidth: 280 }}>
            The app hit an unexpected error. Tap below to try again.
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              marginTop: 8,
              padding: '12px 28px',
              background: colors.gold,
              color: colors.navy,
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
