import React, { useState, useRef, useEffect } from 'react';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [beats, setBeats] = useState<number[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [isMetronomeEnabled, setIsMetronomeEnabled] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [stems, setStems] = useState<Record<string, string> | null>(null);
  const [isSeparating, setIsSeparating] = useState(false);

  // Mixer States
  const [trackStates, setTrackStates] = useState<Record<string, { volume: number, muted: boolean, solo: boolean }>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stemRefs = useRef<Record<string, HTMLAudioElement | null>>({});



  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFile = e.target.files[0];
      setFile(newFile);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(newFile));
      setBpm(null);
      setBeats([]);
      setFilename(null);
      setStems(null);
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setIsAnalyzing(true);
    
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://localhost:8000/analyze", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const errorMessage = errorData?.detail || "Erro na análise";
        throw new Error(errorMessage);
      }
      
      const data = await res.json();
      setBpm(Math.round(data.bpm));
      setBeats(data.beats);
      setFilename(data.filename);
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      alert(msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSeparate = async () => {
    if (!filename) return;
    setIsSeparating(true);
    try {
      const res = await fetch(`http://localhost:8000/separate/${filename}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Erro na separação");
      const data = await res.json();
      
      const fullStems: Record<string, string> = {};
      const initialStates: Record<string, { volume: number; muted: boolean; solo: boolean }> = {};
      for (const [key, path] of Object.entries(data.stems as Record<string, string>)) {
          fullStems[key] = `http://localhost:8000${path}`;
          initialStates[key] = { volume: 1, muted: false, solo: false };
      }
      setStems(fullStems);
      setTrackStates(initialStates);
      setIsPlaying(false);
      setCurrentTime(0);
    } catch (err: unknown) {
      console.error(err);
      alert("Erro ao separar stems. Pode levar alguns minutos caso o modelo esteja baixando.");
    } finally {
      setIsSeparating(false);
    }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSpeed = parseFloat(e.target.value);
    setSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
      (audioRef.current as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    }
  };

  const togglePlay = () => {
    const newIsPlaying = !isPlaying;
    setIsPlaying(newIsPlaying);
    Object.values(stemRefs.current).forEach(audio => {
      if (audio) {
        if (newIsPlaying) audio.play();
        else audio.pause();
      }
    });
  };

  const handleTimeUpdate = () => {
    const firstTrack = Object.values(stemRefs.current)[0];
    if (firstTrack) {
      setCurrentTime(firstTrack.currentTime);
      if (!duration && firstTrack.duration) setDuration(firstTrack.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    Object.values(stemRefs.current).forEach(audio => {
      if (audio) audio.currentTime = time;
    });
  };

  const updateTrack = (name: string, updates: Partial<{ volume: number, muted: boolean, solo: boolean }>) => {
    setTrackStates(prev => {
      const next = { ...prev, [name]: { ...prev[name], ...updates } };
      const anySolo = Object.values(next).some(t => t.solo);
      
      Object.keys(next).forEach(key => {
        const audio = stemRefs.current[key];
        if (audio) {
          const state = next[key];
          audio.volume = state.volume;
          audio.muted = state.muted || (anySolo && !state.solo);
        }
      });
      return next;
    });
  };

  const lastBeatIndexRef = useRef(-1);
  const rafRef = useRef<number>(0);

  const playClick = (isFirstBeat: boolean) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.value = isFirstBeat ? 1500 : 1000;
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  };

  useEffect(() => {
    if (!isMetronomeEnabled || beats.length === 0) {
        lastBeatIndexRef.current = -1;
        return;
    }
    
    if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }

    const checkBeats = () => {
      if (audioRef.current && !audioRef.current.paused) {
        const currentTime = audioRef.current.currentTime;
        const beatIndex = beats.findIndex(b => b >= currentTime && b < currentTime + 0.1);
        
        if (beatIndex !== -1 && beatIndex !== lastBeatIndexRef.current) {
           lastBeatIndexRef.current = beatIndex;
           playClick(beatIndex === 0 || beatIndex % 4 === 0);
        }
      }
      rafRef.current = requestAnimationFrame(checkBeats);
    };

    rafRef.current = requestAnimationFrame(checkBeats);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [isMetronomeEnabled, beats]);

  return (
    <div className="app-container">
      <header>
        <h1>Music Analyzer MVP</h1>
      </header>

      <div className="fiori-card">
        <h2>1. Carregar Áudio</h2>
        <div className="form-group">
          <input type="file" accept="audio/*" onChange={handleFileChange} />
        </div>
        <button 
          className="btn" 
          onClick={handleAnalyze} 
          disabled={!file || isAnalyzing}
        >
          {isAnalyzing ? "Analisando..." : "Analisar BPM e Beats"}
        </button>
      </div>

      {bpm !== null && (
        <div className="fiori-card">
          <h2>2. Resultados da Análise</h2>
          <div className="control-row">
            <div className="stat-box"><span>BPM</span> {bpm}</div>
            <div className="stat-box"><span>Beats</span> {beats.length}</div>
          </div>
        </div>
      )}

      {audioUrl && (
        <div className="fiori-card">
          <h2>3. Estudo e Reprodução</h2>
          <div className="audio-controls">
            <audio 
              ref={audioRef} 
              src={audioUrl} 
              controls 
              className="audio-player-native" 
              loop
            />
            
            <div className="control-row">
              <label>
                Velocidade ({speed.toFixed(2)}x)
                <br/>
                <input 
                  type="range" 
                  min="0.5" 
                  max="1.5" 
                  step="0.05" 
                  value={speed} 
                  onChange={handleSpeedChange} 
                />
              </label>

              <button 
                className={`btn toggle-btn ${isMetronomeEnabled ? 'active' : ''}`}
                onClick={() => setIsMetronomeEnabled(!isMetronomeEnabled)}
                disabled={beats.length === 0}
              >
                {isMetronomeEnabled ? "🔊 Metrônomo ON" : "🔈 Metrônomo OFF"}
              </button>
            </div>
          </div>
        </div>
      )}

      {filename && !stems && (
        <div className="fiori-card">
          <h2>4. Separação de Instrumentos (Demucs)</h2>
          <button 
            className="btn" 
            onClick={handleSeparate} 
            disabled={isSeparating}
          >
            {isSeparating ? "Separando (Isso pode levar alguns minutos)..." : "Extrair Vocais, Bateria, Baixo, Guitarra, Piano e Outros"}
          </button>
        </div>
      )}

      {stems && (
        <div className="fiori-card">
          <h2>4. Studio Mixer</h2>
          <div className="mixer-container">
            <div className="master-controls">
              <button className="btn" onClick={togglePlay}>
                {isPlaying ? "⏸ Pause" : "▶ Play"}
              </button>
              <input 
                type="range" 
                className="master-seek" 
                min="0" 
                max={duration || 100} 
                step="0.1" 
                value={currentTime} 
                onChange={handleSeek} 
              />
              <span className="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span>
            </div>

            <div className="tracks-container">
              {Object.entries(stems).map(([name, url], index) => {
                const isFirst = index === 0;
                return (
                  <div key={name} className="track-row">
                    <audio 
                      src={url} 
                      ref={el => stemRefs.current[name] = el}
                      onTimeUpdate={isFirst ? handleTimeUpdate : undefined}
                      onLoadedMetadata={isFirst ? handleTimeUpdate : undefined}
                      onEnded={isFirst ? () => setIsPlaying(false) : undefined}
                    />
                    
                    <div className="track-controls">
                      <div className="track-header">
                        <span className="track-name">{name.toUpperCase()}</span>
                        <a href={url} download={`${name}.wav`} className="stem-download-btn" title="Baixar">↓</a>
                      </div>
                      <div className="track-buttons">
                        <button 
                          className={`mute-btn ${trackStates[name]?.muted ? 'active' : ''}`}
                          onClick={() => updateTrack(name, { muted: !trackStates[name].muted })}
                          title="Mute"
                        >M</button>
                        <button 
                          className={`solo-btn ${trackStates[name]?.solo ? 'active' : ''}`}
                          onClick={() => updateTrack(name, { solo: !trackStates[name].solo })}
                          title="Solo"
                        >S</button>
                      </div>
                      <input 
                        type="range" 
                        className="volume-slider" 
                        min="0" max="1" step="0.01" 
                        value={trackStates[name]?.volume ?? 1} 
                        onChange={(e) => updateTrack(name, { volume: parseFloat(e.target.value) })}
                      />
                    </div>
                    
                    <div className="track-visual">
                      <div className="track-progress-bg">
                        <div 
                          className={`track-progress-fill color-${name}`} 
                          style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
