import json,os
L=json.load(open('leads_pest.json'))
os.makedirs('lots',exist_ok=True)
for f in os.listdir('lots'): os.remove(os.path.join('lots',f))
for i in range(0,len(L),50):
    name='lot%02d'%(i//50+1)
    json.dump({'leads':L[i:i+50]},open('lots/'+name+'.json','w'),ensure_ascii=False)
    print(name,len(L[i:i+50]),os.path.getsize('lots/'+name+'.json'))
