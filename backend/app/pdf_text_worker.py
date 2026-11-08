"""Short-lived PDF parser. Reads bytes on stdin; never executes PDF actions or saves a PDF."""
import io,json,logging,sys

MAX_BYTES=5*1024*1024
MAX_PAGES=20
MAX_CHARS=8000

def extract(payload):
    from pypdf import PdfReader
    if not payload.startswith(b'%PDF-'):return {'error':'invalid_pdf'}
    reader=PdfReader(io.BytesIO(payload),strict=True)
    if reader.is_encrypted:return {'error':'encrypted_pdf'}
    count=len(reader.pages)
    if not 1<=count<=MAX_PAGES:return {'error':'page_limit'}
    parts=[]
    for number,page in enumerate(reader.pages,1):
        # Reject large decoded content streams before asking text extraction to parse operators.
        stream=page.get_contents()
        if stream is not None and len(stream.get_data())>2*1024*1024:return {'error':'complex_pdf'}
        text=(page.extract_text() or '').replace('\r\n','\n').strip()
        if not text:return {'error':'no_page_text','page':number}
        if '\ufffd' in text or any(ord(c)<32 and c not in '\n\r\t' for c in text):return {'error':'unreadable_text','page':number}
        parts.append(f'[PDF page {number}]\n{text}')
        combined='\n\n'.join(parts)
        if len(combined.encode('utf-16-le'))//2>MAX_CHARS:return {'error':'text_limit'}
    return {'text':'\n\n'.join(parts),'page_count':count}

def main():
    logging.disable(logging.CRITICAL)
    # Windows uses the same short-lived process and timeout; POSIX adds process resource ceilings.
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
        resource.setrlimit(resource.RLIMIT_CPU,(10,10))
    except ImportError:pass
    try:
        from pypdf import overwrite_configuration
        overwrite_configuration(maximum_declared_stream_length=8*1024*1024,
            array_based_stream_maximum_output_length=8*1024*1024,
            zlib_maximum_output_length=8*1024*1024,lzw_maximum_output_length=8*1024*1024,
            run_length_maximum_output_length=8*1024*1024,brotli_maximum_output_length=8*1024*1024,
            stream_decoding_work_maximum_length=32*1024*1024,
            stream_parsing_work_maximum_count=100000,xform_maximum_invocations_per_extraction=500)
        payload=sys.stdin.buffer.read(MAX_BYTES+1)
        result={'error':'file_limit'} if len(payload)>MAX_BYTES else extract(payload)
    except ImportError:result={'error':'dependency_missing'}
    except Exception:result={'error':'invalid_pdf'}
    sys.stdout.write(json.dumps(result,ensure_ascii=True))

if __name__=='__main__':main()
