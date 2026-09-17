"""A3 - Deterministic dialogue state machine (sequence only).

The DM owns *what* to ask; the LLM (if enabled) only helps interpret *how* the
patient answered (doc/09 section 4, MEDCOD pattern). This module is pure
sequence: it decides the ordered turns for a session, including the non-pain
adaptation of the HPI block. It holds no clinical state and makes no decisions
that could fabricate a field.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Turn:
    id: str
    section: str
    kind: str                          # narrative|free_text|choice|yesno|severity
    prompt_en: str
    prompt_hi: str
    slot: str | None = None            # canon slot key filled by this turn
    critical: bool = False
    options: tuple = ()


_PAIN_MARKERS = ("pain", "dard", "दर्द", "sozish", "जलन")


def is_pain_complaint(term: str) -> bool:
    low = (term or "").lower()
    return any(marker in low for marker in _PAIN_MARKERS)


# SOCRATES (pain) vs adapted HPI (non-pain). Both fill the same 8 canon slots.
_SOCRATES_PAIN = (
    ("site", "Where exactly is the pain?", "दर्द कहाँ हो रहा है?"),
    ("onset", "When did it start, and was it sudden?", "यह कब शुरू हुआ, अचानक हुआ?"),
    ("character", "What does it feel like?", "दर्द कैसा लगता है?"),
    ("radiation", "Does it spread anywhere?", "क्या दर्द कहीं और फैलता है?"),
    ("associations", "Any other symptoms with it — breathlessness, sweating, vomiting?",
     "इसके साथ कोई और लक्षण — सांस फूलना, पसीना, उल्टी?"),
    ("timing", "Does it come and go, or is it constant? How long does it last?",
     "यह आता-जाता है या लगातार है? कितनी देर रहता है?"),
    ("exacerbating", "What makes it worse or better?", "किससे बढ़ता या कम होता है?"),
    ("severity", "On a scale of 0 to 10, how bad is it?", "0 से 10 में कितना तेज़ है?"),
)

_SOCRATES_NONPAIN = (
    ("site", "Where do you feel it?", "आपको कहाँ महसूस होता है?"),
    ("onset", "When did it start, and was it sudden?", "यह कब शुरू हुआ, अचानक हुआ?"),
    ("character", "What is it like?", "यह कैसा है?"),
    ("radiation", "Does it spread anywhere?", "क्या यह कहीं और फैलता है?"),
    ("associations", "Any other symptoms with it?", "इसके साथ कोई और लक्षण?"),
    ("timing", "Does it come and go, or is it constant? How long does it last?",
     "यह आता-जाता है या लगातार? कितनी देर रहता है?"),
    ("exacerbating", "What makes it worse or better?", "किससे बढ़ता या कम होता है?"),
    ("severity", "On a scale of 0 to 10, how bad is it?", "0 से 10 में कितना तेज़ है?"),
)

_ROS_SYSTEMS = (
    ("cardio", "Any breathlessness, chest discomfort or palpitations?",
     "सांस फूलना, छाती में तकलीफ़ या धड़कन?"),
    ("resp", "Any cough, sputum or wheezing?", "खांसी, कफ या घरघराहट?"),
    ("gi", "Any vomiting, loose motions or stomach pain?",
     "उल्टी, दस्त या पेट दर्द?"),
    ("neuro", "Any fainting, weakness or fits?", "बेहोशी, कमज़ोरी या दौरे?"),
)


class HistoryFSM:
    """Ordered interview sequence for one complaint."""

    def __init__(self, complaint_term: str = "", is_pain: bool | None = None,
                 ros_systems: tuple = _ROS_SYSTEMS):
        self.complaint_term = complaint_term
        self.is_pain = is_pain_complaint(complaint_term) if is_pain is None else is_pain
        self._turns = self._build(ros_systems)
        self.cursor = 0

    def _build(self, ros_systems: tuple) -> list[Turn]:
        turns: list[Turn] = [
            Turn("narrative", "narrative", "narrative",
                 "Please tell me what brought you here today.",
                 "कृपया बताइए आज आप यहाँ क्यों आए हैं।"),
            Turn("complaint", "complaint", "free_text",
                 "What is your main problem?",
                 "आपकी मुख्य समस्या क्या है?", slot="complaint", critical=True),
        ]
        hpi = _SOCRATES_PAIN if self.is_pain else _SOCRATES_NONPAIN
        for slot, en, hi in hpi:
            turns.append(Turn(f"hpi.{slot}", "hpi",
                              "severity" if slot == "severity" else "free_text",
                              en, hi, slot=slot,
                              critical=slot in ("severity", "onset")))
        turns.append(Turn("safety", "safety", "yesno",
                          "Have you had this suddenly and very severely?",
                          "क्या यह अचानक और बहुत तेज़ हुआ?"))
        turns += [
            Turn("pmh", "history", "free_text",
                 "Any long-term illnesses (BP, diabetes, heart, kidney)?",
                 "कोई पुरानी बीमारी (बीपी, शुगर, हृदय, गुर्दा)?"),
            Turn("medications", "history", "free_text",
                 "What medicines do you take regularly?",
                 "आप नियमित कौन-सी दवाइयाँ लेते हैं?", critical=True),
            Turn("allergies", "history", "free_text",
                 "Any allergies to medicines or food?",
                 "किसी दवा या खाने से एलर्जी?", critical=True),
            Turn("family", "history", "free_text",
                 "Any family history of serious illness?",
                 "परिवार में किसी गंभीर बीमारी का इतिहास?"),
            Turn("social.smoke", "history", "yesno",
                 "Do you smoke or use tobacco?",
                 "आप धूम्रपान या तंबाकू लेते हैं?"),
            Turn("social.alcohol", "history", "yesno",
                 "Do you drink alcohol?", "आप शराब पीते हैं?"),
        ]
        for system, en, hi in ros_systems:
            turns.append(Turn(f"ros.{system}", "ros", "yesno", en, hi))
        turns += [
            Turn("ice.ideas", "ice", "free_text",
                 "What do you think is causing this?",
                 "आपको क्या लगता है यह किस कारण से है?"),
            Turn("ice.concerns", "ice", "free_text",
                 "What worries you most about it?",
                 "इसके बारे में आपको सबसे ज़्यादा क्या चिंता है?"),
            Turn("ice.expectations", "ice", "free_text",
                 "What do you expect from today's visit?",
                 "आज की मुलाक़ात से आप क्या उम्मीद करते हैं?"),
            Turn("readback", "readback", "readback",
                 "Let me read back what I captured. Is it correct?",
                 "मैं जो दर्ज किया है वह पढ़कर सुनाता हूँ। सही है?"),
        ]
        return turns

    # ------------------------------------------------------------------ cursor
    @property
    def turns(self) -> list[Turn]:
        return list(self._turns)

    def current(self) -> Turn | None:
        if self.cursor >= len(self._turns):
            return None
        return self._turns[self.cursor]

    @property
    def phase(self) -> str:
        turn = self.current()
        return turn.section if turn else "done"

    @property
    def done(self) -> bool:
        return self.cursor >= len(self._turns)

    def advance(self) -> Turn | None:
        if not self.done:
            self.cursor += 1
        return self.current()

    def reset(self) -> None:
        self.cursor = 0
