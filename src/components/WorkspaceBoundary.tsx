import { Component, type ReactNode } from 'react';

// Keep the router, query cache and singleton audio engine outside UI recovery.
export class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="workspace-recovery" role="alert"><h1>界面暂时无法显示</h1><p>请尝试恢复界面。</p><button className="primary-button" onClick={() => this.setState({ failed: false })}>恢复界面</button></main>;
  }
}
