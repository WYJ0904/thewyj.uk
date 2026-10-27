const banner=document.getElementById('ownerPreviewBanner');
if(banner){
 const resize=()=>document.documentElement.style.setProperty('--owner-preview-banner-height',`${banner.getBoundingClientRect().height}px`);
 resize();new ResizeObserver(resize).observe(banner);
 try{const response=await fetch('/__preview/build.json',{cache:'no-store',credentials:'omit'});if(!response.ok)throw Error('Preview identity unavailable');const build=await response.json();if(build.environment!=='isolated-preview'||build.source_commit!==banner.dataset.previewSource)throw Error('Preview identity mismatch');banner.dataset.previewVerified='true';banner.title=`独立 Preview · ${build.source_commit} · ${build.artifact_tree_sha256}`;}
 catch{banner.dataset.previewVerified='false';const warning=document.createElement('strong');warning.textContent='构建身份暂未核实，请先核对版本。';banner.append(warning);}
}
