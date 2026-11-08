"""Documented Prisma V3 language hints; mixed speech uses paired codes."""
from typing import Literal
SpeakingMode=Literal['auto','english','hindi','bengali','gujarati','kannada','malayalam','marathi','punjabi','tamil','telugu','hinglish','benglish']
OPTIONS={
 'auto':'indic-auto','english':'en-IN','hindi':'hi-IN','bengali':'bn-IN','gujarati':'gu-IN',
 'kannada':'kn-IN','malayalam':'ml-IN','marathi':'mr-IN','punjabi':'pa-IN','tamil':'ta-IN','telugu':'te-IN',
 'hinglish':'hi-IN,en-IN','benglish':'bn-IN,en-IN',
}
def request_options(mode:SpeakingMode)->dict[str,str]:
    result={'language_code':OPTIONS[mode]}
    if mode in ('hinglish','benglish'):result['format']='codemix'
    return result
