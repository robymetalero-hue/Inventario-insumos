import React, { useState } from 'react';
import { Download, Smartphone, Share2, X, Check, Copy } from 'lucide-react';
import { usePWAInstall } from '../usePWAInstall.ts';

interface Props {
  variant?: 'login' | 'sidebar';
}

export const PWAInstallButton: React.FC<Props> = ({ variant = 'sidebar' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyUrl = () => {
    if (!currentUrl) return;
    navigator.clipboard.writeText(currentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuideModal(true);
    }
  };

  return (
    <>
      {!isInstalled && (
        <button
          type="button"
          onClick={handleInstallClick}
          className={
            variant === 'login'
              ? 'w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-colors border border-slate-200 cursor-pointer'
              : 'w-full py-2 px-3 rounded-xl bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer mb-2'
          }
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>
            {isInstallable
              ? 'Instalar App en Celular / PC'
              : 'Instalar o Abrir en Celular'}
          </span>
        </button>
      )}

      {isInstalled && variant === 'sidebar' && (
        <button
          type="button"
          onClick={() => setShowGuideModal(true)}
          className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer mb-2"
        >
          <Share2 className="w-3.5 h-3.5 shrink-0" />
          <span>Enlace para Celular</span>
        </button>
      )}

      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-slate-900">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Instalar y Abrir en tu Celular
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    ControlStock Pro — Aplicación Web Instalable
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-700">
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
                <p className="font-bold mb-1">
                  1. ¿Cómo activar el enlace público para otros celulares?
                </p>
                <p className="leading-relaxed">
                  Si al abrir el enlace en tu celular ves <strong>Error 404</strong>, en la barra superior derecha de Google AI Studio pulsa el botón <strong>Share (Compartir)</strong> o <strong>Deploy (Publicar)</strong> y activa el acceso público. Una vez compartido, el enlace funcionará en cualquier celular.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Enlace actual de esta aplicación
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={currentUrl}
                    className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>

              {isIOS ? (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <p className="font-bold text-slate-900">
                    2. Cómo instalar en iPhone / iPad (Safari):
                  </p>
                  <p>1. Toca el botón <strong>Compartir</strong> en la barra de Safari.</p>
                  <p>2. Desliza hacia abajo y selecciona <strong>Agregar a pantalla de inicio</strong>.</p>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <p className="font-bold text-slate-900">
                    2. Cómo instalar en Android (Chrome) o PC:
                  </p>
                  <p>
                    1. Abre el enlace en <strong>Google Chrome</strong> en tu teléfono.
                  </p>
                  <p>
                    2. Toca el menú de tres puntos <strong>(⋮)</strong> arriba a la derecha y elige <strong>Instalar aplicación</strong> o <strong>Agregar a la pantalla principal</strong>.
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="mt-5 w-full rounded-xl bg-blue-600 hover:bg-blue-700 py-2.5 text-xs font-bold text-white cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
