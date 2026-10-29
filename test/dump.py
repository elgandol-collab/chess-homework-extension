import sys, json, os
sys.path.insert(0, '/home/claude/homework')
import chess
from homework_model import load_homework, HomeworkFileError
KEYS = ["id","type","instructions","fen","moves","player_color","full_moves","engine_skill","engine_auto_difficulty_enabled",
 "engine_skill_min","engine_skill_max","engine_movetime_ms","engine_clock_seconds","student_clock_seconds","clock_increment_seconds",
 "engine_min_delay_ms","player_min_delay_ms","engine_delay_stages","engine_skill_stages","engine_openings","engine_feedback_enabled",
 "engine_feedback_threshold_cp","good_move_threshold_cp","puzzle_rating"]
out = {}
for f in sorted(os.listdir('fixtures')):
    p = os.path.join('fixtures', f)
    try:
        hw = load_homework(p)
        items = []
        for it in hw.items:
            d = {k: getattr(it, k) for k in KEYS}
            d["player_color"] = "white" if it.player_color == chess.WHITE else "black"
            items.append(d)
        out[f] = {"title": hw.title, "student": hw.student, "sequential": hw.sequential, "items": items}
    except HomeworkFileError as e:
        out[f] = {"error": str(e)[:60]}
json.dump(out, open('py_out.json','w'), ensure_ascii=False, indent=1)
print("python parsed", len(out), "files")
