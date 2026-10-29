import sys, json, os, tempfile
sys.path.insert(0,'/home/claude/homework')
import student_rating as sr
sr.RATING_FILE = os.path.join(tempfile.mkdtemp(), 'r.json')
rows=[]
for old in range(800,2400,37):
    for pr in (800,1000,1200,1500,1873,2400):
        for clean in (True, False):
            json.dump({"rating":old,"solved":3,"correct":2}, open(sr.RATING_FILE,'w'))
            o,n = sr.record_puzzle_result(pr, clean); rows.append([old,pr,clean,n])
json.dump(rows, open('rating_py.json','w')); print(len(rows),'cases')
