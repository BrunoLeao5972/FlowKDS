import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgb(244, 249, 250)',
        colorScheme: 'only light',
        zIndex: 9999,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem 1rem',
        }}
      >
        <div
          style={{
            maxWidth: '64rem',
            width: '100%',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '3rem',
            alignItems: 'center',
          }}
        >
          {/* Left side — Error info */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                backgroundColor: '#fff7ed',
                color: '#c2410c',
                fontSize: '0.875rem',
                fontWeight: 500,
                width: 'fit-content',
              }}
            >
              <AlertCircle style={{ width: '1rem', height: '1rem' }} />
              Erro 404
            </div>

            <div>
              <h1
                style={{
                  fontSize: 'clamp(2.5rem, 6vw, 3.75rem)',
                  fontWeight: 700,
                  color: '#1a1a1a',
                  marginBottom: '0.5rem',
                  lineHeight: 1.1,
                }}
              >
                Página não
                <br />
                <span style={{ color: '#f97316' }}>encontrada</span>
              </h1>
              <p
                style={{
                  fontSize: '1.125rem',
                  color: '#4b5563',
                  marginTop: '1rem',
                  lineHeight: 1.6,
                }}
              >
                Ops! A página que você está procurando não existe.
                Se você acredita que isso pode ser um erro, contate nossa equipe de suporte.
              </p>
            </div>
          </div>

          {/* Right side — Fox video */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'relative', aspectRatio: '16 / 9' }}>
              <video
                autoPlay
                loop
                muted
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  backgroundColor: 'transparent',
                }}
              >
                <source src="/fox not found.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default NotFound;
