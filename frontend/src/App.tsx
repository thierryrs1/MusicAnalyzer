import React, { useState, useRef, useEffect } from 'react';

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
      for (const [key, path] of Object.entries(data.stems as Record<string, string>)) {
          fullStems[key] = `http://localhost:8000${path}`;
      }
      setStems(fullStems);
    } catch (err) {
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
      (audioRef.current as any).preservesPitch = true;
    }
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
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
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
            <div className="stat-box">BPM: {bpm}</div>
            <div className="stat-box">Beats Detectados: {beats.length}</div>
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
            {isSeparating ? "Separando (Isso pode levar alguns minutos)..." : "Extrair Vocais, Bateria, Baixo e Outros"}
          </button>
        </div>
      )}

      {stems && (
        <div className="fiori-card">
          <h2>4. Stem Mixer</h2>
          <div className="stem-mixer">
            {Object.entries(stems).map(([name, url]) => (
              <div key={name} className="stem-track">
                <span className="stem-label">{name.toUpperCase()}</span>
                <audio 
                  src={url} 
                  controls 
                  className="stem-audio" 
                  ref={el => stemRefs.current[name] = el}
                />
                <a href={url} download={`${name}.wav`} className="btn stem-download-btn">Baixar</a>
              </div>
            ))}
          </div>
          <div className="control-row" style={{marginTop: '1rem'}}>
            <button className="btn" onClick={() => Object.values(stemRefs.current).forEach(a => a?.play())}>▶ Play Todos</button>
            <button className="btn" onClick={() => Object.values(stemRefs.current).forEach(a => a?.pause())}>⏸ Pause Todos</button>
            <button className="btn" onClick={() => Object.values(stemRefs.current).forEach(a => { if(a) a.currentTime = 0; })}>⏮ Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
