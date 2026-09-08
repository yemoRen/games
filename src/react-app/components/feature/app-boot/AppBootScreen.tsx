import { InkLoadingBar } from '@app/components/ui/InkLoadingBar';

function isWastelandRoute(): boolean {
  try {
    const p = window.location.pathname || '';
    return p === '/' || p.indexOf('/survival') === 0;
  } catch {
    return false;
  }
}

export function AppBootScreen() {
  // 收打撤（/survival*）使用独立的末世废土加载屏，不显示万界道友标识
  if (isWastelandRoute()) {
    return (
      <div
        className="app-boot-screen"
        role="status"
        aria-live="polite"
        aria-label="末世协议正在加载"
        style={{
          color: '#d4d4d4',
          background:
            'radial-gradient(120% 80% at 50% -10%, rgba(16,185,129,0.10), transparent 60%), radial-gradient(100% 60% at 50% 120%, rgba(245,158,11,0.08), transparent 55%), #0a0a0a',
        }}
      >
        <div className="app-boot-content">
          <div style={{ fontSize: '3rem', lineHeight: 1 }} aria-hidden="true">
            ☢
          </div>
          <div
            style={{
              marginTop: '1.25rem',
              fontWeight: 700,
              letterSpacing: '0.3em',
              color: '#34d399',
            }}
          >
            末世协议
          </div>
          <div
            style={{
              marginTop: '0.35rem',
              fontSize: '0.8rem',
              letterSpacing: '0.35em',
              color: '#f59e0b',
            }}
          >
            系统搜打撤 · 加载中
          </div>
          <InkLoadingBar size="boot" immediate tone="inverse" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-boot-screen"
      role="status"
      aria-live="polite"
      aria-label="万界道友正在加载"
    >
      <div className="app-boot-content">
        <img
          aria-hidden="true"
          alt=""
          className="app-boot-logo"
          src="/assets/app-boot/boot-logo.webp"
          draggable={false}
          fetchPriority="high"
        />
        <div className="app-boot-title-lockup" aria-hidden="true">
          <img
            alt=""
            className="app-boot-title-image"
            src="/assets/app-boot/boot-title.svg"
            draggable={false}
            fetchPriority="high"
          />
          <img
            alt=""
            className="app-boot-seal-image"
            src="/assets/app-boot/boot-seal.webp"
            draggable={false}
            fetchPriority="high"
          />
        </div>
        <InkLoadingBar size="boot" immediate />
        <img
          aria-hidden="true"
          alt=""
          className="app-boot-message-image"
          src="/assets/app-boot/boot-message.svg"
          draggable={false}
        />
      </div>
      <div className="app-boot-motto" aria-hidden="true">
        <span />
        <img alt="" src="/assets/app-boot/boot-motto.svg" draggable={false} />
        <span />
      </div>
    </div>
  );
}
