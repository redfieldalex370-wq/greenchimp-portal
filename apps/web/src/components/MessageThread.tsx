import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { Conversation, Message } from '../types';
import { clockTime, windowCountdown } from '../utils';

type PendingAttachmentKind = 'image' | 'audio' | 'video' | 'sticker';

type PendingAttachment = {
  file: File;
  kind: PendingAttachmentKind;
  previewUrl: string;
};

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

async function getBrowserFfmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
}

async function convertRecordedAudioForWhatsApp(file: File) {
  const ffmpeg = await getBrowserFfmpeg();
  const sourceExtension = file.type.includes('mp4') ? 'm4a' : file.type.includes('ogg') ? 'ogg' : 'webm';
  const inputName = `input.${sourceExtension}`;
  const outputName = 'output.mp3';

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  try {
    await ffmpeg.exec([
      '-i',
      inputName,
      '-vn',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '96k',
      outputName
    ]);

    const output = await ffmpeg.readFile(outputName);
    const bytes = output instanceof Uint8Array ? output : new Uint8Array();
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    return new File([blob], `audio-${Date.now()}.mp3`, { type: 'audio/mpeg' });
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(outputName).catch(() => undefined);
  }
}

function canSendRecordedAudioDirectly(mimeType: string) {
  return mimeType.startsWith('audio/mp4') || mimeType.startsWith('audio/ogg') || mimeType.startsWith('audio/mpeg');
}

function StatusMark({ status }: { status: string }) {
  if (status === 'failed') return <span className="status-mark status-mark--error">!</span>;
  if (status === 'read') return <span className="status-mark status-mark--read">{'\u2713\u2713'}</span>;
  if (status === 'delivered') return <span className="status-mark">{'\u2713\u2713'}</span>;
  return <span className="status-mark">{'\u2713'}</span>;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 1 0 10 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.4 20.6 21 12 3.4 3.4l.2 6.5 9.4 2.1-9.4 2.1-.2 6.5Z" fill="currentColor" />
    </svg>
  );
}

function AudioAttachmentLabel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`audio-attachment-label ${compact ? 'audio-attachment-label--compact' : ''}`}>
      <span>AUDIO</span>
      <strong>Audio adjunto</strong>
    </div>
  );
}

function preferredAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  return '';
}

function MediaContent({ message }: { message: Message }) {
  if (!message.media_id || !message.id) {
    return <p>{message.texto || 'Contenido multimedia no disponible'}</p>;
  }

  const url = `/api/messages/${encodeURIComponent(message.id)}/media`;
  const type = message.tipo.toLowerCase();

  if (type === 'image' || type === 'sticker') {
    return (
      <img
        className={`message-media message-media--${type}`}
        src={url}
        alt={message.texto || (type === 'sticker' ? 'Sticker de WhatsApp' : 'Imagen de WhatsApp')}
        loading="lazy"
      />
    );
  }

  if (type === 'audio' || type === 'voice') {
    return (
      <div className="audio-message-card">
        <AudioAttachmentLabel compact />
        <audio className="message-media message-media--audio" src={url} controls preload="metadata" />
      </div>
    );
  }

  if (type === 'video') {
    return <video className="message-media message-media--video" src={url} controls preload="metadata" />;
  }

  return (
    <a className="media-download" href={url} target="_blank" rel="noreferrer">
      Abrir o descargar archivo
    </a>
  );
}

export function MessageThread({
  conversation,
  messages,
  loading,
  sending,
  onSend,
  onSendMedia,
  onSendMediaById,
  onError,
  onBack,
  onOpenContact
}: {
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  onSend: (text: string) => Promise<void>;
  onSendMedia: (type: string, file: File, caption: string) => Promise<void>;
  onSendMediaById: (type: string, mediaId: string, caption: string) => Promise<void>;
  onError: (message: string) => void;
  onBack?: () => void;
  onOpenContact?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioMimeType = preferredAudioMimeType();
  const canRecordAudio = Boolean(audioMimeType) && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversation?.wa_id]);

  useEffect(() => {
    return () => {
      if (pendingAttachment) URL.revokeObjectURL(pendingAttachment.previewUrl);
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
    };
  }, [pendingAttachment]);

  function clearAttachment() {
    setPendingAttachment((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }

  useEffect(() => {
    setAttachmentMenuOpen(false);
    setStickerPickerOpen(false);
    clearAttachment();
  }, [conversation?.wa_id]);

  const safeMessages = useMemo(
    () =>
      Array.isArray(messages)
        ? messages.filter((message): message is Message => Boolean(message?.tipo && (message.id || message.message_id)))
        : [],
    [messages]
  );

  const recentStickers = useMemo(
    () =>
      safeMessages
        .filter((message) => message.tipo.toLowerCase() === 'sticker' && message.media_id && message.id)
        .filter((message, index, list) => list.findIndex((item) => item.media_id === message.media_id) === index)
        .slice(-18)
        .reverse(),
    [safeMessages]
  );

  if (!conversation) {
    return (
      <section className="thread-column thread-column--empty">
        <div className="brand-orbit">GC</div>
        <h2>Selecciona una conversacion</h2>
        <p>El historial aparecera aqui.</p>
      </section>
    );
  }

  const activeConversation = conversation;

  async function submit(event?: FormEvent) {
    event?.preventDefault();

    if (pendingAttachment) {
      const caption = draft.trim();
      try {
        await onSendMedia(pendingAttachment.kind, pendingAttachment.file, caption);
        setDraft('');
        clearAttachment();
      } catch {
        return;
      }
      return;
    }

    const text = draft.trim();
    if (!text || sending || !activeConversation.ventana_abierta) return;

    setDraft('');
    try {
      await onSend(text);
    } catch {
      setDraft(text);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  async function selectAttachment(kind: PendingAttachmentKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      if (kind === 'sticker' && file.type !== 'image/webp') {
        throw new Error('Por ahora los stickers solo aceptan archivos WEBP.');
      }
      clearAttachment();
      setPendingAttachment({
        file,
        kind,
        previewUrl: URL.createObjectURL(file)
      });
      setAttachmentMenuOpen(false);
      setStickerPickerOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo preparar el archivo.');
    }
  }

  async function startAudioRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Este navegador no permite grabar audio desde la pagina.');
      }

      setAttachmentMenuOpen(false);
      setStickerPickerOpen(false);
      clearAttachment();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioMimeType();

      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Este navegador no genera un audio compatible para convertir.');
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      recorderRef.current = recorder;

      recorder.ondataavailable = (recordEvent) => {
        if (recordEvent.data.size > 0) recordingChunksRef.current.push(recordEvent.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        const rawFile = new File([blob], `audio-${Date.now()}.${extension}`, { type: blob.type });

        try {
          const finalFile = canSendRecordedAudioDirectly(rawFile.type)
            ? rawFile
            : await convertRecordedAudioForWhatsApp(rawFile);
          await onSendMedia('audio', finalFile, '');
        } catch (error) {
          onError(error instanceof Error ? error.message : 'No se pudo preparar el audio para enviarlo.');
        } finally {
          recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
          recorderRef.current = null;
          setRecording(false);
        }
      };

      recorder.start();
      setRecording(true);
    } catch (error) {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      onError(error instanceof Error ? error.message : 'No se pudo iniciar la grabacion.');
    }
  }

  function stopAudioRecording() {
    recorderRef.current?.stop();
  }

  async function sendExistingSticker(mediaId: string) {
    if (!activeConversation.ventana_abierta || sending) return;
    setStickerPickerOpen(false);
    await onSendMediaById('sticker', mediaId, '');
  }

  return (
    <section className="thread-column">
      <header className="thread-header">
        <button type="button" className="mobile-back-button" onClick={onBack} aria-label="Volver a conversaciones">
          ‹
        </button>
        <div className="thread-header__identity">
          <h2>{conversation.nombre}</h2>
          <p>{conversation.wa_id}</p>
        </div>
        <div className="thread-header__actions">
          <span className={`window-chip ${conversation.ventana_abierta ? '' : 'window-chip--closed'}`}>
            {windowCountdown(conversation.ventana_expira)}
          </span>
          <button type="button" className="mobile-contact-button" onClick={onOpenContact} aria-label="Abrir opciones del contacto">
            ⋮
          </button>
        </div>
      </header>

      <div className="message-scroll">
        {safeMessages.map((message) => {
          const mediaType = message.tipo.toLowerCase();
          return (
            <article
              key={message.id || message.message_id}
              className={`message-row ${message.direccion === 'out' ? 'message-row--out' : ''}`}
            >
              <div
                className={`message-bubble ${message.direccion === 'out' ? 'message-bubble--out' : ''} ${
                  message.tipo !== 'text' ? `message-bubble--${mediaType}` : ''
                }`}
              >
                {message.tipo === 'text' ? <p>{message.texto}</p> : <MediaContent message={message} />}
                {message.tipo !== 'text' && message.texto && <p className="media-caption">{message.texto}</p>}
                <footer>
                  {message.direccion === 'out' && <span>{message.autor}</span>}
                  <time>{clockTime(message.creado_en)}</time>
                  {message.direccion === 'out' && <StatusMark status={message.estado} />}
                </footer>
              </div>
            </article>
          );
        })}

        {loading && safeMessages.length === 0 && <div className="empty-thread">Cargando historial...</div>}
        {!loading && safeMessages.length === 0 && <div className="empty-thread">Todavia no hay mensajes guardados.</div>}
        <div ref={bottomRef} />
      </div>

      <form className={`composer ${pendingAttachment ? 'composer--with-attachment' : ''}`} onSubmit={submit}>
        {pendingAttachment && (
          <div className={`attachment-preview attachment-preview--${pendingAttachment.kind}`}>
            <div className="attachment-preview__media">
              {pendingAttachment.kind === 'audio' ? (
                <div className="audio-message-card">
                  <AudioAttachmentLabel />
                  <audio src={pendingAttachment.previewUrl} controls preload="metadata" />
                </div>
              ) : pendingAttachment.kind === 'video' ? (
                <video src={pendingAttachment.previewUrl} controls preload="metadata" />
              ) : (
                <img
                  src={pendingAttachment.previewUrl}
                  alt={pendingAttachment.kind === 'sticker' ? 'Sticker seleccionado' : 'Archivo seleccionado'}
                />
              )}
            </div>
            <button
              type="button"
              className="attachment-preview__remove"
              onClick={clearAttachment}
              aria-label="Quitar archivo"
            >
              x
            </button>
          </div>
        )}

        <div className="composer-row">
          <div className="attachment-menu">
            <button
              type="button"
              className="attachment-trigger"
              onClick={() => setAttachmentMenuOpen((open) => !open)}
              disabled={!conversation.ventana_abierta || sending}
              aria-label="Adjuntar multimedia"
              aria-expanded={attachmentMenuOpen}
            >
              +
            </button>

            {attachmentMenuOpen && (
              <div className="attachment-popover">
                <button type="button" onClick={() => imageInputRef.current?.click()}>
                  <span>I</span>
                  Imagen
                </button>
                <button type="button" onClick={() => videoInputRef.current?.click()}>
                  <span>V</span>
                  Video
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStickerPickerOpen((open) => !open);
                    setAttachmentMenuOpen(false);
                  }}
                >
                  <span>S</span>
                  Sticker
                </button>
              </div>
            )}

            {stickerPickerOpen && (
              <div className="sticker-picker">
                <div className="sticker-picker__grid">
                  {recentStickers.map((message) => (
                    <button
                      type="button"
                      key={message.id}
                      onClick={() => void sendExistingSticker(message.media_id!)}
                      aria-label="Enviar sticker"
                    >
                      <img src={`/api/messages/${encodeURIComponent(message.id)}/media`} alt="" loading="lazy" />
                    </button>
                  ))}
                  <button
                    type="button"
                    className="sticker-picker__upload"
                    onClick={() => stickerInputRef.current?.click()}
                    aria-label="Subir sticker"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => void selectAttachment('image', event)}
              hidden
            />
            <input
              ref={stickerInputRef}
              type="file"
              accept="image/webp"
              onChange={(event) => void selectAttachment('sticker', event)}
              hidden
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              onChange={(event) => void selectAttachment('video', event)}
              hidden
            />
          </div>

          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={keyDown}
            placeholder={conversation.ventana_abierta ? 'Escribe un mensaje...' : 'Ventana cerrada - se requiere plantilla'}
            disabled={!conversation.ventana_abierta || sending}
            rows={1}
          />

          <button
            type="button"
            className={`mic-button ${recording ? 'mic-button--recording' : ''}`}
            onClick={() => void (recording ? stopAudioRecording() : startAudioRecording())}
            disabled={!conversation.ventana_abierta || sending || (!recording && !canRecordAudio)}
            aria-label={recording ? 'Detener grabacion' : 'Grabar audio'}
            title={
              recording
                ? 'Detener grabacion'
                : canRecordAudio
                  ? 'Grabar audio'
                  : 'La grabacion por microfono no esta disponible en este navegador'
            }
          >
            {recording ? <span className="mic-button__stop" aria-hidden="true" /> : <MicIcon />}
          </button>

          <button
            className="send-button"
            disabled={(!draft.trim() && !pendingAttachment) || !conversation.ventana_abierta || sending}
            aria-label="Enviar mensaje"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </section>
  );
}
