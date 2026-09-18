import React, { useState, useRef, useEffect } from 'react';

function formatTime(seconds: number) {
  if (!seconds || isNaN(seconds)) return "0:00";
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

  const [lyrics, setLyrics] = useState<{word: string, start: number, end: number}[] | null>(null);
  const [isExtractingLyrics, setIsExtractingLyrics] = useState(false);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLDivElement>(null);

  // Mixer States
  const [trackStates, setTrackStates] = useState<Record<string, { volume: number; muted: boolean; solo: boolean }>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [midiProcessing, setMidiProcessing] = useState<string | null>(null);
  const [vocalNotes, setVocalNotes] = useState<any[]>([]);
  const stemRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});
  const audioCtxRef = useRef<AudioContext | null>(null);

  const runAnalysis = async (fileToAnalyze: File) => {
    setIsAnalyzing(true);
    
    const formData = new FormData();
    formData.append("file", fileToAnalyze);

    try {
      const res = await fetch("http://localhost:8000/analyze", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.detail || "Erro na análise");
      }
      
      const data = await res.json();
      setBpm(Math.round(data.bpm));
      setBeats(data.beats);
      setFilename(data.filename);
    } catch (err: unknown) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (activeLyricRef.current && lyricsContainerRef.current) {
      activeLyricRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime]);

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
      setLyrics(null);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      
      runAnalysis(newFile);
    }
  };

  const handleSeparate = async () => {
    if (!filename) return;
    setIsSeparating(true);
    try {
      const res = await fetch(`http://localhost:8000/separate/${filename}`, { method: "POST" });
      if (!res.ok) throw new Error("Erro na separação");
      const data = await res.json();
      
      const fullStems: Record<string, string> = {};
      const initialStates: Record<string, { volume: number; muted: boolean; solo: boolean }> = {};
      for (const [key, path] of Object.entries(data.stems as Record<string, string>)) {
          fullStems[key] = `http://localhost:8000${path}`;
          initialStates[key] = { volume: 1, muted: false, solo: false };
      }
      initialStates["metronome"] = { volume: 1, muted: false, solo: false };
      
      // Pause the original audio
      if (audioRef.current) audioRef.current.pause();

      setStems(fullStems);
      setTrackStates(initialStates);
      setIsPlaying(false);
      setCurrentTime(0);
    } catch (err: unknown) {
      console.error(err);
      alert("Erro ao separar stems.");
    } finally {
      setIsSeparating(false);
    }
  };

  const handleExtractLyrics = async () => {
    if (!filename) return;
    setIsExtractingLyrics(true);
    try {
      const res = await fetch(`http://localhost:8000/lyrics/${filename}`, { method: "POST" });
      if (!res.ok) throw new Error("Erro na extração de letras");
      const data = await res.json();
      setLyrics(data.lyrics);
    } catch (error) {
      console.error(error);
      alert('Erro ao extrair letras.');
    } finally {
      setIsExtractingLyrics(false);
    }
  };

  const extractMidi = async (stem: string) => {
    if (!filename) return;
    setMidiProcessing(stem);
    try {
      const response = await fetch(`http://localhost:8000/midi/${encodeURIComponent(filename)}/${stem}`, {
        method: 'POST'
      });
      const data = await response.json();
      console.log('MIDI Response:', data);
      if (data.notes) {
        setVocalNotes(data.notes);
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao gerar MIDI");
    } finally {
      setMidiProcessing(null);
    }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSpeed = parseFloat(e.target.value);
    setSpeed(newSpeed);
    
    if (stems) {
      Object.values(stemRefs.current).forEach(audio => {
        if (audio) {
          audio.playbackRate = newSpeed;
          (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
        }
      });
    } else if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
      (audioRef.current as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    }
  };

  const togglePlay = () => {
    const newIsPlaying = !isPlaying;
    setIsPlaying(newIsPlaying);
    
    if (stems) {
      Object.values(stemRefs.current).forEach(audio => {
        if (audio) {
          if (newIsPlaying) audio.play();
          else audio.pause();
        }
      });
    } else if (audioRef.current) {
      if (newIsPlaying) audioRef.current.play();
      else audioRef.current.pause();
    }
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const el = e.currentTarget;
    setCurrentTime(el.currentTime);
    if (!duration && el.duration && !isNaN(el.duration)) setDuration(el.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (stems) {
      Object.values(stemRefs.current).forEach(audio => {
        if (audio) audio.currentTime = time;
      });
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
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

  // Metronome Logic
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
    
    const metronomeVol = trackStates["metronome"]?.volume ?? 1;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime((isFirstBeat ? 0.8 : 0.5) * metronomeVol, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  };

  useEffect(() => {
    const metronomeState = trackStates["metronome"];
    const anySolo = Object.values(trackStates).some(t => t.solo);
    let isActive = false;

    if (stems && metronomeState) {
      isActive = !metronomeState.muted && (!anySolo || metronomeState.solo);
    } else {
      isActive = isMetronomeEnabled;
    }

    if (!isPlaying || !isActive || beats.length === 0) {
      lastBeatIndexRef.current = -1;
      return;
    }

    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }

    const checkBeats = () => {
      let currentAudioTime = 0;
      let isPaused = true;
      if (stems && stemRefs.current[Object.keys(stems)[0]]) {
        const ref = stemRefs.current[Object.keys(stems)[0]]!;
        currentAudioTime = ref.currentTime;
        isPaused = ref.paused;
      } else if (audioRef.current) {
        currentAudioTime = audioRef.current.currentTime;
        isPaused = audioRef.current.paused;
      }

      if (!isPaused) {
        const beatIndex = beats.findIndex(b => b >= currentAudioTime && b < currentAudioTime + 0.1);
        if (beatIndex !== -1 && beatIndex !== lastBeatIndexRef.current) {
           lastBeatIndexRef.current = beatIndex;
           playClick(beatIndex === 0 || beatIndex % 4 === 0);
        }
      }
      rafRef.current = requestAnimationFrame(checkBeats);
    };

    rafRef.current = requestAnimationFrame(checkBeats);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMetronomeEnabled, beats, stems, isPlaying, trackStates]);

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="logo">Music Analyzer</div>
        <div className="header-actions">
          {bpm !== null && (
            <div className="bpm-badge">BPM: {bpm} • {beats.length} beats</div>
          )}
          {file && (
            <label className="btn">
              Trocar Música
              <input type="file" accept="audio/*" onChange={handleFileChange} hidden />
            </label>
          )}
        </div>
      </header>

      {!file ? (
        <div className="empty-state">
          <h2>Importe uma música para começar</h2>
          <label className="btn btn-large">
            Selecionar Arquivo
            <input type="file" accept="audio/*" onChange={handleFileChange} hidden />
          </label>
        </div>
      ) : (
        <div className="workspace">
          {/* Área do Mixer Principal */}
          <div className="mixer-area">
            {!stems ? (
              <div className="original-track-view">
                {/* Trilha Original */}
                <div className="track-row" style={{width: '100%'}}>
                  <audio 
                    src={audioUrl || ''} 
                    ref={audioRef} 
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleTimeUpdate}
                    onEnded={() => setIsPlaying(false)}
                  />
                  <div className="track-controls">
                    <span className="track-name">FAIXA ORIGINAL</span>
                  </div>
                  <div className="track-visual">
                    <div className="track-progress-bg">
                      <div 
                        className="track-progress-fill color-original" 
                        style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
                
                {/* Overlay de Extração */}
                <div className="extract-overlay">
                  <h3 style={{marginTop: 0, fontWeight: 400}}>Música pronta para mixagem</h3>
                  <button 
                    className="btn btn-large" 
                    onClick={handleSeparate} 
                    disabled={isSeparating || isAnalyzing || !filename}
                  >
                    {isSeparating 
                      ? "Processando Inteligência Artificial (Aguarde 2-5 minutos)..." 
                      : (isAnalyzing ? "Analisando..." : "Separar Faixas (Vocais, Bateria, Baixo, Guitarra...)")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="tracks-wrapper">
                  
                  {/* PIANO ROLL (Modo Estudo) */}
                  {vocalNotes.length > 0 && (
                    <div className="piano-roll-panel">
                      <h3>Estudo de Melodia (Vocais)</h3>
                      <div className="piano-roll-container">
                        
                        {/* Grid background */}
                        <div className="piano-grid">
                          {[...Array(48)].map((_, i) => (
                            <div key={i} className="piano-grid-line" style={{ top: `${(i / 48) * 100}%` }}></div>
                          ))}
                        </div>
                        
                        <div className="piano-playhead" style={{ left: '20%' }}></div>
                        
                        {(() => {
                          const windowSize = 10;
                          const playheadOffset = 2;
                          
                          const visibleNotes = vocalNotes.filter(n => 
                            (n.start - currentTime + playheadOffset) < windowSize &&
                            (n.end - currentTime + playheadOffset) > 0
                          );
                          
                          const minP = 36;
                          const maxP = 84;
                          const pRange = maxP - minP;
                          
                          return visibleNotes.map((note, i) => {
                            const left = ((note.start - currentTime + playheadOffset) / windowSize) * 100;
                            const width = ((note.end - note.start) / windowSize) * 100;
                            
                            const clampedPitch = Math.max(minP, Math.min(maxP, note.pitch));
                            const top = (1 - (clampedPitch - minP) / pRange) * 100;
                            
                            const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
                            const noteName = noteNames[note.pitch % 12] + Math.floor(note.pitch / 12 - 1);

                            return (
                              <div 
                                key={i} 
                                className="midi-note" 
                                title={`Nota: ${noteName}`}
                                style={{ 
                                  left: `${left}%`, 
                                  width: `${Math.max(0.5, width)}%`, 
                                  top: `${top}%`,
                                  height: `${100 / pRange}%`
                                }}
                              />
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}

                  <div className="tracks-container">
                {Object.entries(stems).map(([name, url], index) => {
                  const isFirst = index === 0;
                  return (
                    <div key={name} className="track-row">
                      <audio 
                        src={url} 
                        ref={el => { stemRefs.current[name] = el; }}
                        onTimeUpdate={isFirst ? handleTimeUpdate : undefined}
                        onLoadedMetadata={isFirst ? handleTimeUpdate : undefined}
                        onEnded={isFirst ? () => setIsPlaying(false) : undefined}
                      />
                      
                      <div className="track-controls">
                        <div className="track-header">
                          <span className="track-name">{name.toUpperCase()}</span>
                          <div style={{display: 'flex', gap: '8px'}}>
                            <button 
                              onClick={() => extractMidi(name)} 
                              className="download-icon" 
                              title="Extrair notas para MIDI"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', opacity: midiProcessing === name ? 0.5 : 1 }}
                              disabled={midiProcessing === name}
                            >
                              🎹
                            </button>
                            <a href={url} download={`${name}.wav`} className="download-icon" title="Baixar">↓</a>
                          </div>
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
                      
                      <div 
                        className="track-waveform-container"
                        style={{
                          maskImage: `url("http://localhost:8000/waveform/${encodeURIComponent(filename!)}/${name}")`,
                          WebkitMaskImage: `url("http://localhost:8000/waveform/${encodeURIComponent(filename!)}/${name}")`
                        }}
                      >
                        <div 
                          className={`track-waveform-fill color-${name}`} 
                          style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
                
                {/* Faixa Artificial do Metrônomo */}
                <div className="track-row" key="metronome">
                  <div className="track-controls">
                    <div className="track-header">
                      <span className="track-name">METRONOME</span>
                    </div>
                    <div className="track-buttons">
                      <button 
                        className={`mute-btn ${trackStates["metronome"]?.muted ? 'active' : ''}`}
                        onClick={() => updateTrack("metronome", { muted: !trackStates["metronome"]?.muted })}
                      >M</button>
                      <button 
                        className={`solo-btn ${trackStates["metronome"]?.solo ? 'active' : ''}`}
                        onClick={() => updateTrack("metronome", { solo: !trackStates["metronome"]?.solo })}
                      >S</button>
                    </div>
                    <div className="volume-slider">
                      <input 
                        type="range" 
                        min="0" max="1" step="0.01" 
                        value={trackStates["metronome"]?.volume ?? 1} 
                        onChange={(e) => updateTrack("metronome", { volume: parseFloat(e.target.value) })}
                      />
                    </div>
                  </div>
                  
                  <div className="track-waveform-container">
                    <div 
                      className="track-waveform-fill" 
                      style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%', borderRightColor: '#ffffff' }}
                    ></div>
                  </div>
                </div>
                </div>

              </div>

                <div className="lyrics-panel">
                  <div className="lyrics-header">
                    <h3>Letras & Karaokê</h3>
                    {!lyrics && (
                      <button 
                        className="btn" 
                        style={{padding: '0.4rem 0.8rem', fontSize: '0.8rem'}}
                        onClick={handleExtractLyrics}
                        disabled={isExtractingLyrics}
                      >
                        {isExtractingLyrics ? "Transcrevendo..." : "Extrair Letras (IA)"}
                      </button>
                    )}
                  </div>
                  
                  <div className="lyrics-content" ref={lyricsContainerRef}>
                    {!lyrics ? (
                      <div style={{color: 'var(--moises-text-muted)', fontSize: '1rem', marginTop: '2rem'}}>
                        Extraia as letras para acompanhar a música palavra por palavra.
                      </div>
                    ) : (
                      lyrics.map((lyric, i) => {
                        const isActive = currentTime >= lyric.start && currentTime < lyric.end;
                        return (
                          <div 
                            key={i} 
                            ref={isActive ? activeLyricRef : null}
                            className={`lyric-line ${isActive ? 'active' : ''}`}
                            onClick={() => {
                              // Optional click-to-seek
                              const audioElement = stemRefs.current["vocals"] || Object.values(stemRefs.current)[0];
                              if (audioElement) {
                                audioElement.currentTime = lyric.start;
                              }
                            }}
                          >
                            {lyric.word}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Barra de Transporte Unificada (Movida para baixo) */}
          <div className="transport-bar">
            <button className="play-btn" onClick={togglePlay} disabled={isAnalyzing || isSeparating}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            
            <div className="seek-container">
              <span className="time">{formatTime(currentTime)}</span>
              <input 
                type="range" 
                className="master-seek" 
                min="0" 
                max={duration || 100} 
                step="0.1" 
                value={currentTime} 
                onChange={handleSeek} 
                disabled={isAnalyzing || isSeparating}
              />
              <span className="time">{formatTime(duration)}</span>
            </div>
            
            <div className="extra-controls">
              <div className="speed-control">
                <span>{speed}x</span>
                <input 
                  type="range" 
                  min="0.5" 
                  max="1.5" 
                  step="0.05" 
                  value={speed} 
                  onChange={handleSpeedChange} 
                  disabled={isAnalyzing || isSeparating}
                />
              </div>
              
              {!stems && (
                <button 
                  className={`metronome-btn ${isMetronomeEnabled ? 'active' : ''}`}
                  onClick={() => setIsMetronomeEnabled(!isMetronomeEnabled)}
                  disabled={beats.length === 0}
                >
                  {isMetronomeEnabled ? '🔊 Metrônomo' : '🔈 Metrônomo'}
                </button>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

export default App;
