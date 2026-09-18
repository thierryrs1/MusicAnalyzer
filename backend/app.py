import os
import shutil
import librosa
import numpy as np
import subprocess
import sys
import asyncio
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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
        # Remover termos do youtube "(youtube)" etc
        search_query = re.sub(r'\(.*?\)', '', safe_filename).strip()
        search_query = search_query.replace("-", " ")
        lrc = syncedlyrics.search(search_query)
        if lrc:
            lyrics = []
            pattern = re.compile(r'\[(\d+):(\d+\.\d+)\](.*)')
            lines = lrc.split('\n')
            for line in lines:
                match = pattern.search(line)
                if match:
                    minutes = int(match.group(1))
                    seconds = float(match.group(2))
                    text = match.group(3).strip()
                    if text:
                        start_time = minutes * 60 + seconds
                        lyrics.append({
                            "word": text,
                            "start": start_time,
                            "end": start_time + 5 # valor temporario
                        })
            # Arrumar os tempos de end
            for i in range(len(lyrics) - 1):
                lyrics[i]['end'] = lyrics[i+1]['start']
            
            if lyrics:
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
