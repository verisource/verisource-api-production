#!/usr/bin/env python3
"""
Pyannote Voice Embedding Extractor for VeriSource
Extracts speaker embeddings from audio files using pyannote.audio
"""
import sys
import json
import os

def extract_embedding(audio_path):
    try:
        from pyannote.audio import Model, Inference
        import torch
        
        # Get HuggingFace token
        hf_token = os.environ.get('HUGGINGFACE_TOKEN')
        if not hf_token:
            return {"success": False, "error": "HUGGINGFACE_TOKEN not set"}
        
        # Load the pretrained embedding model
        model = Model.from_pretrained(
            "pyannote/embedding",
            use_auth_token=hf_token
        )
        
        # Create inference object
        inference = Inference(model, window="whole")
        
        # Extract embedding from audio file
        embedding = inference(audio_path)
        
        # Convert to list for JSON serialization
        embedding_list = embedding.tolist() if hasattr(embedding, 'tolist') else list(embedding)
        
        # Flatten if needed (pyannote returns 2D array sometimes)
        if isinstance(embedding_list[0], list):
            embedding_list = embedding_list[0]
        
        return {
            "success": True,
            "embedding": embedding_list,
            "embedding_size": len(embedding_list),
            "method": "pyannote"
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No audio path provided"}))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    result = extract_embedding(audio_path)
    print(json.dumps(result))
