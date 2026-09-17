import React, { useState, useRef, useEffect } from 'react';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [beats, setBeats] = useState<number[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [isMetronomeEnabled, setIsMetronomeEnabled] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setBpm(null);
      setBeats([]);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
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
      if (!res.ok) throw new Error("Erro na análise");
      const data = await res.json();
      setBpm(Math.round(data.bpm));
      setBeats(data.beats);
    } catch (err) {
      console.error(err);
      alert("Erro ao analisar o áudio. Verifique se o backend está rodando em http://localhost:8000.");
    } finally {
      setIsAnalyzing(false);
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
        // Look for the current beat (within a 100ms window)
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

  const playClick = (isFirstBeat: boolean) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Higher frequency for first beat of a measure (assuming 4/4)
    osc.frequency.value = isFirstBeat ? 1500 : 1000;
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  };

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
    </div>
  );
}

export default App;
