// Image attachments: a thumbnail that opens full screen, a download button on
// each picture, and a bulk download for everything a reply brought with it.
// Bytes are fetched with the bearer token, so these components own the object
// URLs and release them on unmount.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { ChatImage } from "../lib/types";
import { errMessage } from "./common";

/** Save one image to disk through a temporary anchor element. */
async function saveImages(token: string, images: ChatImage[]): Promise<string | null> {
  for (const image of images) {
    try {
      const blob = await api.documentBlob(token, image.documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = image.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Give the browser a moment to start the save before the URL disappears.
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      return errMessage(e);
    }
  }
  return null;
}

function useImageUrl(token: string, documentId: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    api
      .documentBlob(token, documentId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (active) setError(errMessage(e));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, documentId]);

  return { url, error };
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14.5V16h12v-1.5" strokeLinecap="round" />
    </svg>
  );
}

/** A thumbnail in the transcript: click to open, hover for a download button. */
export function ImageThumb({
  token,
  image,
  onOpen,
}: {
  token: string;
  image: ChatImage;
  onOpen: () => void;
}) {
  const { url, error } = useImageUrl(token, image.documentId);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { t } = useI18n();

  if (error) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
        {error}
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[rgb(var(--glass-border))] bg-slate-950/30">
      {url ? (
        <button type="button" onClick={onOpen} className="block w-full cursor-zoom-in">
          <img
            src={url}
            alt={image.filename}
            className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        </button>
      ) : (
        <div className="aspect-[4/3] w-full animate-pulse bg-slate-800/40" />
      )}
      <button
        type="button"
        onClick={() => {
          setSaveError(null);
          // saveImages reports failure by *returning* the message, so the result
          // has to be kept — a thumbnail download that silently does nothing
          // looks like a broken button.
          void saveImages(token, [image]).then(setSaveError);
        }}
        aria-label={t("Download {name}", { name: image.filename })}
        title={t("Download {name}", { name: image.filename })}
        className="absolute right-2 top-2 rounded-full bg-black/55 p-2 text-white opacity-0 backdrop-blur transition group-hover:opacity-100 focus-visible:opacity-100"
      >
        <DownloadIcon />
      </button>
      {saveError && (
        <span
          role="alert"
          className="absolute left-2 top-2 max-w-[70%] rounded-lg bg-rose-500/85 px-2 py-1 text-[11px] text-white"
        >
          {saveError}
        </span>
      )}
      <span className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-[11px] text-white/90">
        {image.filename}
      </span>
    </div>
  );
}

/** Full-screen viewer: the picture at its own size, with download and close. */
export function ImageViewer({
  token,
  image,
  onClose,
}: {
  token: string;
  image: ChatImage;
  onClose: () => void;
}) {
  const { url, error } = useImageUrl(token, image.documentId);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { t } = useI18n();

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onKey]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.filename}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-xl"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4 text-white/90">
        <span className="truncate text-sm">{image.filename}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void saveImages(token, [image]).then(setSaveError);
            }}
            className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur transition hover:bg-white/25"
          >
            {t("Download")}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="rounded-full bg-white/15 px-3 py-2 text-sm text-white backdrop-blur transition hover:bg-white/25"
            aria-label={t("Close viewer")}
          >
            {t("Close")}
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {error || saveError ? (
          <p className="text-sm text-rose-200">{error ?? saveError}</p>
        ) : url ? (
          <img
            src={url}
            alt={image.filename}
            className="max-h-full max-w-full rounded-xl object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <p className="text-sm text-white/70">{t("Loading…")}</p>
        )}
      </div>
    </div>
  );
}

/** "Download all" for a reply that brought more than one image. */
export function DownloadAllButton({ token, images }: { token: string; images: ChatImage[] }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  if (images.length < 2) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void saveImages(token, images)
            .then(setError)
            .finally(() => setBusy(false));
        }}
        className="glass liquid-lift inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-slate-200"
      >
        <DownloadIcon />
        {busy ? t("Saving…") : t("Download all {count} images", { count: images.length })}
      </button>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}
