import React from 'react';

/**
 * App-wide error boundary. A crash in any page must never blank the whole
 * dashboard: the boundary catches it, logs it, and offers a way back.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[broodiinnox] page crash:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 560, margin: '10vh auto', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 44, fontWeight: 900, color: 'var(--brand-blue)' }}>BROODIINNOX</div>
        <h2 style={{ margin: '8px 0' }}>Something went wrong on this page</h2>
        <p className="muted">
          Your devices and settings are safe. Please reload — if it keeps happening,
          contact Afriinnox support with the message below.
        </p>
        <div style={{ margin: 16 }} className="muted small">
          {String((this.state.error && this.state.error.message) || this.state.error).slice(0, 300)}
        </div>
        <button
          className="btn primary"
          onClick={() => { this.setState({ error: null }); window.location.hash = '#/'; }}
        >
          Go to dashboard
        </button>{' '}
        <button className="btn" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
