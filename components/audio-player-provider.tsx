'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { BASE_PATH } from '@/lib/constants';

type Track = { articleId: string; title: string; durationMs?: number | null };
type PlayerContextValue = { play: (track: Track) => void };

const PlayerContext = createContext<PlayerContextValue | null>(null);

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [loadError, setLoadError] = useState(false);

  const wireAudio = useCallback((audio: HTMLAudioElement) => {
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('timeupdate', () =>
      setCurrentTime(audio.currentTime),
    );
    audio.addEventListener('durationchange', () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    });
    audio.addEventListener('ended', () => setPlaying(false));
    audio.addEventListener('error', () => setLoadError(true));
  }, []);

  const play = useCallback(
    (nextTrack: Track) => {
      const existing = audioRef.current;
      if (track?.articleId === nextTrack.articleId && existing) {
        void existing.play().catch(() => setLoadError(true));
        return;
      }

      existing?.pause();
      const audio = new Audio(
        `${BASE_PATH}/api/v1/articles/${nextTrack.articleId}/audio/stream`,
      );
      audio.preload = 'metadata';
      audio.playbackRate = rate;
      wireAudio(audio);
      audioRef.current = audio;
      setTrack(nextTrack);
      setCurrentTime(0);
      // 如果服务端已知时长，先用它；等 durationchange 事件后会覆盖为精确值
      setDuration(
        nextTrack.durationMs ? nextTrack.durationMs / 1000 : 0,
      );
      setLoadError(false);
      void audio.play().catch(() => setLoadError(true));
    },
    [rate, track?.articleId, wireAudio],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
    window.localStorage.setItem('daily-audio-rate', String(rate));
  }, [rate]);

  useEffect(() => {
    return () => audioRef.current?.pause();
  }, []);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setLoadError(true));
    else audio.pause();
  }

  function seek(next: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(next, duration || next));
    setCurrentTime(audio.currentTime);
  }

  function close() {
    audioRef.current?.pause();
    audioRef.current = null;
    setTrack(null);
    setPlaying(false);
  }

  return (
    <PlayerContext.Provider value={{ play }}>
      <div className={track ? 'has-player' : undefined}>{children}</div>
      {track ? (
        <section className="audio-capsule" aria-label="文章朗读播放器">
          <div className="player-title">
            <span aria-hidden="true">
              <Volume2 />
            </span>
            <div>
              <small>
                {loadError ? '音频加载失败' : playing ? '正在朗读' : '已暂停'}
              </small>
              <strong title={track.title}>{track.title}</strong>
            </div>
          </div>
          <div className="player-controls">
            <Button
              variant="ghost"
              size="icon"
              aria-label="后退 15 秒"
              onClick={() => seek(currentTime - 15)}
            >
              <SkipBack />
            </Button>
            <Button
              size="icon-lg"
              aria-label={playing ? '暂停' : '播放'}
              onClick={togglePlayback}
            >
              {loadError ? <RotateCcw /> : playing ? <Pause /> : <Play />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="前进 15 秒"
              onClick={() => seek(currentTime + 15)}
            >
              <SkipForward />
            </Button>
          </div>
          <div className="player-progress">
            <span>{formatTime(currentTime)}</span>
            <Slider
              aria-label="朗读进度"
              min={0}
              max={Math.max(1, duration)}
              step={1}
              value={[Math.min(currentTime, Math.max(1, duration))]}
              onValueChange={(values) =>
                seek(Array.isArray(values) ? (values[0] ?? 0) : values)
              }
            />
            <span>{formatTime(duration)}</span>
          </div>
          <select
            aria-label="播放倍速"
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
          >
            {[0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option value={value} key={value}>
                {value}×
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭播放器"
            onClick={close}
          >
            <X />
          </Button>
        </section>
      ) : null}
    </PlayerContext.Provider>
  );
}

export function ReadAloudButton({
  articleId,
  title,
  status,
  durationMs,
}: Track & { status: string }) {
  const player = useContext(PlayerContext);
  const ready = status === 'READY';
  const processing = [
    'QUEUED',
    'SYNTHESIZING',
    'ASSEMBLING',
    'RETRY_WAIT',
  ].includes(status);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={!ready}
      onClick={() => player?.play({ articleId, title, durationMs })}
      className="read-aloud-button"
    >
      <Volume2 />
      {ready ? '朗读文章' : processing ? '朗读生成中' : '朗读暂不可用'}
    </Button>
  );
}
