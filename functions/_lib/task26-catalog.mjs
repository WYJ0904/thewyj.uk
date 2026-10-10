import { COMMON_RUBRICS, COMMON_JAPANESE_FORMS } from './task15-vocabulary.mjs';
import { normalizeMeaning, normalizeWord, normalizeKana } from './task15-model.mjs';

export const COURSE_VERSION = 'aeris-language-v1';
const extra = {
  japanese: [
    ['山','やま','山','山が見えます。','能看见山。'],
    ['目','め','眼睛','目を閉じます。','闭上眼睛。'],
    ['手','て','手','手を洗います。','洗手。'],
    ['言葉','ことば','语言','日本語の言葉を覚えます。','记住日语词汇。'],
    ['家族','かぞく','家人','家族と食事します。','和家人吃饭。'],
    ['部屋','へや','房间','部屋を掃除します。','打扫房间。'],
    ['雪','ゆき','雪','雪が降っています。','正在下雪。'],
    ['音楽','おんがく','音乐','音楽を聞きます。','听音乐。'],
    ['本','ほん','书','本を読みます。','读书。'],
    ['学校','がっこう','学校','学校へ行きます。','去学校。'],
    ['先生','せんせい','老师','先生に聞きます。','向老师询问。'],
    ['学生','がくせい','学生','私は学生です。','我是学生。'],
    ['私','わたし','我','私は日本語を勉強します。','我学习日语。'],
    ['友達','ともだち','朋友','友達と話します。','和朋友交谈。'],
    ['食べる','たべる','吃','ご飯を食べます。','吃饭。'],
    ['飲む','のむ','喝','水を飲みます。','喝水。'],
    ['見る','みる','看','テレビを見ます。','看电视。'],
    ['聞く','きく','听','音楽を聞きます。','听音乐。'],
    ['行く','いく','去','学校へ行きます。','去学校。'],
    ['来る','くる','来','友達が来ます。','朋友来。'],
    ['帰る','かえる','回家','家に帰ります。','回家。'],
    ['大きい','おおきい','大的','大きい家です。','是大房子。'],
    ['小さい','ちいさい','小的','小さい猫です。','是小猫。'],
    ['新しい','あたらしい','新的','新しい本です。','是新书。'],
    ['古い','ふるい','旧的','古い家です。','是旧房子。'],
    ['鼻','はな','鼻子','鼻が痛いです。','鼻子痛。'],
    ['橋','はし','桥','橋を渡ります。','过桥。'],
    ['箸','はし','筷子','箸を使います。','使用筷子。'],
  ],
  english: [
    ['water','','水','I drink water.','我喝水。'],
    ['friend','','朋友','She is my friend.','她是我的朋友。'],
    ['teacher','','老师','Our teacher is kind.','我们的老师很亲切。'],
    ['student','','学生','I am a student.','我是学生。'],
    ['read','','读','I read a book.','我读一本书。'],
    ['write','','写','I write a letter.','我写一封信。'],
    ['learn','','学习','We learn English.','我们学习英语。'],
    ['happy','','高兴的','She is happy.','她很高兴。'],
    ['difficult','','困难的','This question is difficult.','这道题很难。'],
    ['remember','','记住','I remember your name.','我记得你的名字。'],
  ],
};
const examples = {
  apple:['I eat an apple.','我吃一个苹果。'], book:['This is my book.','这是我的书。'],
  cat:['The cat is sleeping.','猫正在睡觉。'],dog:['The dog is running.','狗正在跑。'],
  flower:['The flower is beautiful.','这朵花很美。'],green:['The bag is green.','这个包是绿色的。'],
  hello:['Hello, my friend.','你好，我的朋友。'],house:['This is our house.','这是我们的房子。'],
  idea:['That is a good idea.','那是一个好主意。'],light:['Please turn on the light.','请开灯。'],
  music:['I like music.','我喜欢音乐。'],orange:['I eat an orange.','我吃一个橙子。'],
  school:['I go to school.','我去学校。'],world:['We live in the same world.','我们生活在同一个世界。'],
  電話:['電話をかけます。','打电话。'],花:['花が咲いています。','花正在开放。'],
  水:['水を飲みます。','喝水。'],アドバイザー:['アドバイザーに相談します。','向顾问咨询。'],
};
const confusion = {
  'japanese:花':{terms:['花','鼻'],text:'花和鼻都读はな，但花表示花朵，鼻表示鼻子；根据汉字和语境区分。'},
  'japanese:鼻':{terms:['花','鼻'],text:'鼻是鼻子，花是花朵；两者都读はな，但汉字和语境不同。'},
  'japanese:橋':{terms:['橋','箸'],text:'橋表示桥，箸表示筷子；都可写作はし，需结合汉字与语境判断。'},
  'japanese:箸':{terms:['橋','箸'],text:'箸是筷子，橋是桥；不要只凭假名はし判断含义。'},
  'english:learn':{terms:['learn','study'],text:'learn强调学会或获得知识，study强调学习过程；本题对应learn。'},
  'english:remember':{terms:['remember','remind'],text:'remember是记住，remind表示提醒某人；不要混淆动作主体。'},
};
const items=[];
const seen=new Set();
function vocabulary(language,word,rubric,example){
  if(language==='japanese') word=COMMON_JAPANESE_FORMS[word]?.[1] || word;
  const id=`${language}:vocabulary:${normalizeWord(word,language)}`;
  if(seen.has(id))return;seen.add(id);
  const ex=example || examples[word] || ['', ''];
  const point={id,language,kind:'vocabulary',word,label:word,reading:rubric.reading||'',gloss:rubric.gloss,
    accepted:[rubric.gloss,...(rubric.accepted||[])],difficulty:1,level:language==='japanese'?'n5':'primary_3',
    example:ex[0],example_translation:ex[1],notes:rubric.notes||'',confusion:confusion[`${language}:${word}`]||null};
  point.questions=[{id:`${id}:meaning`,family:'meaning',kind:'meaning',prompt:word,instruction:'写出中文含义',answers:point.accepted}];
  if(language==='japanese' && point.reading)point.questions.push({id:`${id}:reading`,family:'reading',kind:'reading',prompt:word,instruction:'写出假名读音',answers:[point.reading]});
  if(language==='english')point.questions.push({id:`${id}:spelling`,family:'spelling',kind:'spelling',prompt:rubric.gloss,instruction:'写出对应的英语单词',answers:[word]});
  items.push(point);
}
for(const [word,rubric] of Object.entries(COMMON_RUBRICS))vocabulary(rubric.language==='英语'?'english':'japanese',word,rubric);
for(const [language,rows] of Object.entries(extra))for(const [word,reading,gloss,example,translation] of rows)vocabulary(language,word,{gloss,reading,accepted:[]},[example,translation]);
const grammar=[
  ['english','present-third-person','一般现在时第三人称',2,'第三人称单数的一般现在时通常在动词后加s。',
    [['She ___ (study) English every day.','按括号动词原形填入一般现在时第三人称单数。',['studies']],['He ___ (go) to school every day.','按括号动词原形填入一般现在时第三人称单数。',['goes']]]],
  ['english','past-simple','一般过去时',2,'过去的动作使用过去式；本题中的过去式为明确的课程答案。',
    [['I ___ (read) a book yesterday.','按括号动词原形填入过去式。',['read']],['She ___ (go) to school yesterday.','按括号动词原形填入过去式。',['went']]]],
  ['english','present-continuous','现在进行时',2,'现在进行时使用be加动词ing形式。',
    [['She is ___ (read) a book now.','按括号动词原形填入现在分词。',['reading']],['They are ___ (learn) English now.','按括号动词原形填入现在分词。',['learning']]]],
  ['japanese','topic-wa','主题助词は',1,'主题助词写は，读作わ，用于提示句子的主题。',
    [['私___学生です。','填入提示主题的助词。',['は']],['これ___本です。','填入提示主题的助词。',['は']]]],
  ['japanese','object-wo','宾语助词を',1,'を标记动作的直接对象，常见于食べる、読む等动词之前。',
    [['本___読みます。','填入标记直接宾语的助词。',['を']],['水___飲みます。','填入标记直接宾语的助词。',['を']]]],
  ['japanese','place-de','动作场所で',2,'で标记动作发生的场所；存在的位置通常用に。',
    [['図書館___勉強します。','填入标记动作发生场所的助词。',['で']],['家___ご飯を食べます。','填入标记动作发生场所的助词。',['で']]]],
];
for(const [language,key,label,difficulty,notes,questions] of grammar){
 const id=`${language}:grammar:${key}`;
 items.push({id,language,kind:'grammar',label,word:label,gloss:label,reading:'',difficulty,level:language==='japanese'?'n5':'middle_1',notes,
   example:questions[0][0].replace('___',questions[0][2][0]).replace(/ \([a-z]+\)/g,''),example_translation:questions[0][1],
   confusion:key==='place-de'?{terms:['で','に'],text:'で用于动作发生场所；に用于存在地点等。本题描述的是动作。'}:null,
   questions:questions.map(([prompt,translation,answers],i)=>({id:`${id}:cloze${i}`,family:`cloze${i}`,kind:'cloze',prompt,instruction:`填入空缺：${translation}`,answers}))});
}
export const KNOWLEDGE_POINTS=Object.freeze(items.map(p=>Object.freeze(p)));
export const POINTS_BY_ID=new Map(KNOWLEDGE_POINTS.map(p=>[p.id,p]));
export function catalog(language){return KNOWLEDGE_POINTS.filter(p=>p.language===language);}
export function questionById(id){for(const point of KNOWLEDGE_POINTS){const question=point.questions.find(q=>q.id===id);if(question)return {point,question};}return null;}
export function gradeQuestion(question,answer,language){
 const normalized=question.kind==='meaning'?normalizeMeaning(answer):question.kind==='reading'?normalizeKana(answer).replace(/\s/gu,''):normalizeWord(answer,language);
 return Boolean(normalized) && question.answers.some(expected=>(question.kind==='meaning'?normalizeMeaning(expected):question.kind==='reading'?normalizeKana(expected).replace(/\s/gu,''):normalizeWord(expected,language))===normalized);
}
export function basicExplanation(point,question){return {source:'course',rule:point.notes||`${point.word}：${point.gloss}`,why:question.kind==='reading'?`本题考查${point.word}的读音：${point.reading}。`:`本题的课程答案是${question.answers.join(' / ')}。`,
 example:point.example||'',translation:point.example_translation||'',reading:point.reading||'',confusion:point.confusion?.text||'',suggestion:`稍后复习${point.label}，再尝试同一知识点的其他题型。`};}
