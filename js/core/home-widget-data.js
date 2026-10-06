/** Pure presentation of the existing dashboard owners; never fetches or persists. */
export function projectHomeWidgets({ demo=false, records=[], wrongCount=0, streak=0, goals=[], finance={}, financeKnown=false, tools={}, toolsReady=true, workflow={}, online=true, learningStatus={}, money=String, language=String, time=String, now=new Date() }={}) {
  const item=(label,value,detail,status,state='ready',extra='')=>({label,value,detail,status,state,extra});
  if(demo)return {
    demo:true,
    learning:{modes:{latest:item('学习记录','日语','6 题 · 正确率 83%','学习演示'),today:item('今日进度','12 / 20 题','日语练习','学习演示'),streak:item('连续学习','3 天','学习进度演示','学习演示'),wrong:item('错题数量','5 个','复习进度演示','学习演示')},extra:'演示内容不会写入账户。'},
    finance:{modes:{balance:item('本月账本','¥ 3,284.60','本月收支余额','账本演示'),income:item('本月收入','¥ 8,520.00','本月收入合计','账本演示'),expense:item('本月支出','¥ 5,235.40','本月支出合计','账本演示')},extra:'演示账本，不是账户数据。'},
    tools:{modes:{recent:item('最近工具','JSON 格式化','仅在浏览器处理','工具演示'),favorites:item('收藏工具','2 项收藏','工具偏好演示','工具演示'),workflow:item('最近工作流','文本清理','工具流程演示','工具演示')},extra:'试用不保存到正式账户。'},
    activity:[],
  };
  const sorted=records.filter(x=>Number.isFinite(Date.parse(x.finishedAt))).slice().sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt)),latest=sorted[0];
  const today=sorted.filter(x=>new Date(x.finishedAt).toDateString()===new Date(now).toDateString()).reduce((n,x)=>n+Number(x.total||0),0);
  const learnState=latest?'ready':learningStatus.status==='failed'?'error':learningStatus.status==='syncing'?'loading':'empty';
  const learnStatus=learningStatus.status==='failed'?'同步未完成 · 本机记录保留':learningStatus.status==='syncing'?'同步中':online?'学习记录':'离线 · 本机记录';
  const goalText=goals.map(x=>`${language(x.language)} ${x.completed} / ${x.goal} 题`).join(' · ');
  const finState=financeKnown?'ready':online?'loading':'error',finValue=value=>financeKnown?money(value):online?'尚未读取':'暂时不可用';
  const finStatus=financeKnown?(online?'账户账本摘要':'离线 · 缓存摘要'):(online?'打开账本读取':'联网后打开账本重试');
  const recent=tools.recent||[],favorites=tools.favorites||[],toolState=toolsReady?'empty':online?'loading':'error';
  const activity=[...sorted.slice(0,3).map(x=>({id:'learning:'+x.id,at:x.finishedAt,label:`完成了 ${x.total} 道${language(x.language)}练习题`,path:'learning'})),...recent.slice(0,3).filter(x=>Number.isFinite(Date.parse(x.used_at))).map(x=>({id:'tool:'+x.tool_id,at:x.used_at,label:`使用了${x.name||x.tool_id}`,path:'/tools/'+encodeURIComponent(x.tool_id)}))].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,4);
  const latestWorkflow=workflow.recent?.[0];
  return {
    demo:false,
    learning:{modes:{latest:item('学习记录',latest?language(latest.language):learnState==='loading'?'正在读取':learnState==='error'?'暂时不可用':'暂无记录',latest?`${latest.total} 题 · 正确率 ${latest.accuracy}%`:'完成测试后显示进度',learnStatus,learnState),today:item('今日进度',`${today} 题`,goalText,learnStatus,learnState),streak:item('连续学习',`${streak} 天`,'按已完成学习记录计算',learnStatus,learnState),wrong:item('错题数量',`${wrongCount} 个`,'进入学习后复习',learnStatus,learnState)},extra:goalText},
    finance:{modes:{balance:item('本月账本',finValue(finance.balance_minor),'本月收支余额',finStatus,finState),income:item('本月收入',finValue(finance.income_minor),'本月收入合计',finStatus,finState),expense:item('本月支出',finValue(finance.expense_minor),'本月支出合计',finStatus,finState)},extra:financeKnown?`${finance.count||0} 笔记录 · ${finance.last_sync_at?'最近同步 '+time(finance.last_sync_at):'本机修改待同步'}`:'打开账本查看真实收支。'},
    tools:{modes:{recent:item('最近工具',recent[0]?.name||(toolsReady?'暂无最近工具':online?'正在读取':'暂时不可用'),recent[0]?.used_at?time(recent[0].used_at):'使用后显示最近工具',recent.length?`${favorites.length} 项收藏`:'工具箱',recent.length?'ready':toolState),favorites:item('收藏工具',favorites[0]?.name||(toolsReady?'暂无收藏工具':'尚未读取'),`${favorites.length} 项收藏`,'工具箱',favorites.length?'ready':toolState),workflow:item('最近工作流',latestWorkflow?.name||(workflow.known?'暂无工作流':'尚未读取'),latestWorkflow?'最近编辑 '+time(latestWorkflow.updated_at):'打开工作流后读取','工具箱',latestWorkflow?'ready':workflow.known?'empty':'loading')},extra:`${favorites.length} 项收藏 · ${recent.length} 项最近使用`,continuePath:recent[0]?'/tools/'+encodeURIComponent(recent[0].tool_id):''},
    activity,
  };
}
