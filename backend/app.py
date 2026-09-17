import os
import shutil
import librosa
import numpy as np
import subprocess
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
async def separate_audio(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        return {"message": "File not found", "stems": {}}
        
    # Run Demucs via subprocess
    cmd = ["python", "-m", "demucs.separate", "-n", "htdemucs", "-o", SEPARATED_DIR, file_path]
    subprocess.run(cmd, check=True)
    
    track_name = os.path.splitext(filename)[0]
    stems_dir = f"htdemucs/{track_name}"
    
    stems_urls = {
        "vocals": f"/stems/{stems_dir}/vocals.wav",
        "drums": f"/stems/{stems_dir}/drums.wav",
        "bass": f"/stems/{stems_dir}/bass.wav",
        "other": f"/stems/{stems_dir}/other.wav"
    }
    
    return SeparateResponse(
        message="Separation complete",
        stems=stems_urls
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
