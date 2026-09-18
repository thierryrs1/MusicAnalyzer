import os
import shutil
import librosa
import numpy as np
import subprocess
import sys
import asyncio
from fastapi import FastAPI, File, UploadFile, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from scipy.io import wavfile

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For MVP only
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
SEPARATED_DIR = "separated"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(SEPARATED_DIR, exist_ok=True)

app.mount("/stems", StaticFiles(directory=SEPARATED_DIR), name="stems")

class AnalysisResult(BaseModel):
    bpm: float
    beats: list[float]
    filename: str

@app.post("/analyze", response_model=AnalysisResult)
async def analyze_audio(file: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Load audio with librosa
    try:
        y, sr = librosa.load(file_path, sr=None)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao ler formato de áudio: {str(e)}")
    
    # Detect BPM and Beats
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    
    return AnalysisResult(
        bpm=float(tempo[0] if isinstance(tempo, (list, tuple, np.ndarray)) else tempo),
        beats=beat_times.tolist(),
        filename=file.filename
    )

class SeparateResponse(BaseModel):
    message: str
    stems: dict[str, str]

@app.post("/separate/{filename}", response_model=SeparateResponse)
def separate_audio(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        return {"message": "File not found", "stems": {}}
        
    safe_filename = os.path.splitext(filename)[0]
    stems_dir = f"htdemucs_6s/{safe_filename}"
    absolute_stems_dir = os.path.join(SEPARATED_DIR, stems_dir)
    
    if not os.path.exists(absolute_stems_dir):
        # Run Demucs via subprocess using sys.executable to ensure the correct venv
        cmd = [sys.executable, "-m", "demucs.separate", "-n", "htdemucs_6s", "-o", SEPARATED_DIR, file_path]
        subprocess.run(cmd, check=True)
    
    stems_urls = {
        "vocals": f"/stems/{stems_dir}/vocals.wav",
        "drums": f"/stems/{stems_dir}/drums.wav",
        "bass": f"/stems/{stems_dir}/bass.wav",
        "guitar": f"/stems/{stems_dir}/guitar.wav",
        "piano": f"/stems/{stems_dir}/piano.wav",
        "other": f"/stems/{stems_dir}/other.wav"
    }
    
    return SeparateResponse(
        message="Separation complete",
        stems=stems_urls
    )

whisper_model = None
def get_whisper_model():
    global whisper_model
    if whisper_model is None:
        from faster_whisper import WhisperModel
        # Use CPU para maior compatibilidade no MVP, com int8 para não consumir toda a RAM
        whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
    return whisper_model

def run_transcription(vocals_path):
    model = get_whisper_model()
    # word_timestamps=True permite obter o tempo exato de cada palavra
    segments, info = model.transcribe(vocals_path, word_timestamps=True)
    lyrics = []
    for segment in segments:
        for word in segment.words:
            if word.word.strip():
                lyrics.append({
                    "word": word.word.strip(),
                    "start": word.start,
                    "end": word.end
                })
    return lyrics

import re
import syncedlyrics

@app.post("/lyrics/{filename}")
async def extract_lyrics(filename: str):
    safe_filename = os.path.splitext(filename)[0]
    
    # 1. Tentar buscar online com syncedlyrics (MUITO mais rápido)
    try:
        search_query = re.sub(r'\(.*?\)', '', safe_filename).strip()
        search_query = search_query.replace("-", " ")
        lrc = syncedlyrics.search(search_query)
        if lrc:
            lyrics = []
            pattern = re.compile(r'\[(\d+):(\d+\.\d+)\](.*)')
            lines = lrc.split('\n')
            
            # Extract basic times first
            for line in lines:
                match = pattern.search(line)
                if match:
                    minutes = int(match.group(1))
                    seconds = float(match.group(2))
                    text = match.group(3).strip()
                    if text:
                        lyrics.append({
                            "word": text,
                            "original_start": minutes * 60 + seconds
                        })
                        
            if lyrics:
                # Dynamic Sync Offset calculation using the vocals file
                sync_offset = 0.0
                vocals_path = os.path.join(SEPARATED_DIR, "htdemucs_6s", safe_filename, "vocals.wav")
                if os.path.exists(vocals_path):
                    try:
                        from scipy.io import wavfile
                        import numpy as np
                        sr, data = wavfile.read(vocals_path)
                        if len(data.shape) > 1:
                            data = data.mean(axis=1)
                        threshold = 0.05 * np.max(np.abs(data))
                        non_silent = np.where(np.abs(data) > threshold)[0]
                        if len(non_silent) > 0:
                            actual_start = non_silent[0] / sr
                            lrc_start = lyrics[0]["original_start"]
                            sync_offset = lrc_start - actual_start
                            print(f"DEBUG: Sync offset calculated: {sync_offset}s")
                    except Exception as e:
                        print(f"Erro no cálculo de offset: {e}")
                
                # Apply offset
                for i in range(len(lyrics)):
                    start_time = max(0, lyrics[i]["original_start"] - sync_offset)
                    lyrics[i]["start"] = start_time
                    lyrics[i]["end"] = start_time + 5
                
                # Fix end times
                for i in range(len(lyrics) - 1):
                    lyrics[i]['end'] = lyrics[i+1]['start']
                
                return {"lyrics": lyrics}
    except Exception as e:
        print(f"Erro no syncedlyrics: {e}")

    # 2. Fallback para Inteligência Artificial local (Whisper)
    vocals_path = os.path.join(SEPARATED_DIR, "htdemucs_6s", safe_filename, "vocals.wav")
    
    if not os.path.exists(vocals_path):
        raise HTTPException(status_code=404, detail="Faixa vocal não encontrada e não foi possível achar a letra online.")
        
    try:
        loop = asyncio.get_event_loop()
        lyrics = await loop.run_in_executor(None, run_transcription, vocals_path)
        return {"lyrics": lyrics}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/waveform/{filename}/{stem}")
def get_waveform(filename: str, stem: str):
    safe_filename = os.path.splitext(filename)[0]
    wav_path = os.path.join(SEPARATED_DIR, "htdemucs_6s", safe_filename, f"{stem}.wav")
    svg_path = os.path.join(SEPARATED_DIR, "htdemucs_6s", safe_filename, f"{stem}.svg")
    print(f"DEBUG: filename={filename}, safe={safe_filename}, stem={stem}")
    print(f"DEBUG: wav_path={wav_path}")
    
    if not os.path.exists(wav_path):
        print("DEBUG: WAV NOT FOUND")
        raise HTTPException(status_code=404, detail="WAV file not found")
        
    if not os.path.exists(svg_path):
        try:
            samplerate, data = wavfile.read(wav_path)
            if len(data.shape) > 1:
                data = data.mean(axis=1)
            num_bars = 500
            chunk_size = len(data) // num_bars
            peaks = []
            for i in range(num_bars):
                chunk = data[i*chunk_size : (i+1)*chunk_size]
                if len(chunk) > 0:
                    peaks.append(np.max(np.abs(chunk)))
                else:
                    peaks.append(0)
            peaks = np.array(peaks)
            max_peak = np.max(peaks) if np.max(peaks) > 0 else 1
            peaks = peaks / max_peak * 100
            bars = []
            for i, p in enumerate(peaks):
                h = max(1, p)
                bars.append(f'<rect x="{i*2}" y="{50 - h/2}" width="1" height="{h}" rx="0.5" fill="#fff"/>')
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 100" preserveAspectRatio="none">{"".join(bars)}</svg>'
            with open(svg_path, 'w') as f:
                f.write(svg)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
            
    with open(svg_path, 'r') as f:
        svg_content = f.read()
        
    return Response(content=svg_content, media_type="image/svg+xml")

@app.post("/midi/{filename}/{stem}")
def generate_midi(filename: str, stem: str):
    safe_filename = os.path.splitext(filename)[0]
    wav_path = os.path.join(SEPARATED_DIR, "htdemucs_6s", safe_filename, f"{stem}.wav")
    midi_path = os.path.join(SEPARATED_DIR, "htdemucs_6s", safe_filename, f"{stem}.mid")
    
    if not os.path.exists(wav_path):
        raise HTTPException(status_code=404, detail="WAV file not found")
        
    try:
        import librosa
        import numpy as np
        import pretty_midi
        import scipy.signal
        
        y, sr = librosa.load(wav_path, sr=22050)
        f0 = librosa.yin(y, fmin=65.4, fmax=1046.5, sr=sr, frame_length=2048)
        
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
        if np.max(rms) > 0:
            rms = rms / np.max(rms)
            
        f0 = np.where(f0 > 0, f0, 1.0)
        midi_pitches = librosa.hz_to_midi(f0)
        midi_pitches = np.round(midi_pitches).astype(int)
        
        min_len = min(len(midi_pitches), len(rms))
        midi_pitches = midi_pitches[:min_len]
        rms = rms[:min_len]
        
        midi_pitches[rms < 0.05] = 0
        midi_pitches = scipy.signal.medfilt(midi_pitches, kernel_size=5)
        
        notes = []
        current_pitch = 0
        start_frame = 0
        
        for i, pitch in enumerate(midi_pitches):
            if pitch != current_pitch:
                if current_pitch > 0:
                    start_time = librosa.frames_to_time(start_frame, sr=sr, hop_length=512)
                    end_time = librosa.frames_to_time(i, sr=sr, hop_length=512)
                    if end_time - start_time >= 0.1:
                        notes.append({
                            "pitch": int(current_pitch),
                            "start": start_time,
                            "end": end_time,
                            "velocity": 100
                        })
                current_pitch = pitch
                start_frame = i
                
        if current_pitch > 0:
            start_time = librosa.frames_to_time(start_frame, sr=sr, hop_length=512)
            end_time = librosa.frames_to_time(len(midi_pitches), sr=sr, hop_length=512)
            if end_time - start_time >= 0.1:
                notes.append({
                    "pitch": int(current_pitch),
                    "start": start_time,
                    "end": end_time,
                    "velocity": 100
                })
                
        pm = pretty_midi.PrettyMIDI()
        inst = pretty_midi.Instrument(program=52) # Choir Aahs
        for n in notes:
            note = pretty_midi.Note(
                velocity=n['velocity'],
                pitch=n['pitch'],
                start=n['start'],
                end=n['end']
            )
            inst.notes.append(note)
        pm.instruments.append(inst)
        pm.write(midi_path)
        
        return {"message": "MIDI generated successfully", "notes": notes, "midi_url": f"/stems/htdemucs_6s/{safe_filename}/{stem}.mid"}
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
