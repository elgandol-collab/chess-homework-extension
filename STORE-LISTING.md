# Store listing drafts

**Name:** Chess Homework Trainer — مدرب واجبات الشطرنج
**Category:** Education
**Short description (≤132 chars):** Solve your chess coach's homework — puzzles, openings and games vs Stockfish. Works offline; data stays on your device.

**Long description (EN):**
Open the homework file your chess coach sent you (.pgn or .chesshw.json) and train right in your browser:
• Tactical puzzles and opening drills with instant feedback
• Games against Stockfish with clocks, "take it slow" pauses and move counters
• Smart hints: a gentle warning when a move loses ground, and praise for strong moves
• Export your result as a file (or open WhatsApp) and send it to your coach
Everything runs locally and offline. No account, no ads, no tracking. Open source (GPLv3).

**الوصف (AR):**
افتح ملف الواجب اللي بعتهولك مدرب الشطرنج (.pgn أو .chesshw.json) وتدرّب جوه المتصفح: ألغاز وافتتاحيات وتمارين لعب ضد Stockfish بساعات وتنبيهات "لا تتسرع" وعدّاد نقلات، مع تنبيه ذكي لما تغلط وتشجيع لما تلعب نقلة قوية. صدّر النتيجة كملف أو افتح واتساب وابعتها للمدرب. كل شيء بيشتغل على جهازك بدون حساب ولا إعلانات ولا تتبع. مفتوح المصدر (GPLv3).

**Single purpose:** Let students solve chess homework files provided by their coach.
**Permission justification — `storage`:** Saves the student's progress, puzzle rating and language/sound preferences on their own device (chrome.storage.local).
**Data usage:** The extension does not collect, transmit or sell any user data. **Remote code:** none — the engine (WebAssembly) and all scripts are bundled.
**Note for reviewers:** the extension page CSP includes `'wasm-unsafe-eval'` only to run the bundled Stockfish WebAssembly engine.
