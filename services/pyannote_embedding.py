#!/usr/bin/env python3
import sys, json, os, warnings, logging

# Suppress all warnings and logging
warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"

# Redirect stderr during imports
import io
old_stderr = sys.stderr
sys.stderr = io.StringIO()

def extract_embedding(audio_path):
    try:
        from pyannote.audio import Model, Inference
        hf_token = os.environ.get("HUGGINGFACE_TOKEN")
        if not hf_token:
            return {"success": False, "error": "HUGGINGFACE_TOKEN not set"}
        model = Model.from_pretrained("pyannote/embedding", use_auth_token=hf_token)
        inference = Inference(model, window="whole")
        embedding = inference(audio_path)
        embedding_list = embedding.tolist() if hasattr(embedding, "tolist") else list(embedding)
        if isinstance(embedding_list[0], list):
            embedding_list = embedding_list[0]
        return {"success": True, "embedding": embedding_list, "embedding_size": len(embedding_list), "method": "pyannote"}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        sys.stderr = old_stderr

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No audio path"}))
        sys.exit(1)
    result = extract_embedding(sys.argv[1])
    sys.stderr = old_stderr
    print(json.dumps(result))