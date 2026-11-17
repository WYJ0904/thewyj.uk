import {
  createUploadSession, allocateUploadFile, uploadPart, uploadSessionState,
  completeUploadSession, abortUploadSession, authorizeShareDownload, revokeShare,
} from './task22-service.mjs';
import { cleanId, cleanFileName, normalizeMime, safeInteger, MAX_SHARE_BYTES, sharePayload, Task22Error, requireAllowedFields } from './task22-model.mjs';
import { authorizeFileDownload, cancelFileReservation } from './task14-service.mjs';
import { filePayload } from './task14-model.mjs';
import { task20TokenFromRequest } from './task20-model.mjs';

const requireUser = account => {
  if (!account?.id) throw new Task22Error('请先登录',401,'authentication_required');
  return String(account.id);
};

async function ownedTransfer(db,account,fileId) {
  const owner=requireUser(account),id=cleanId(fileId,'文件标识');
  const row=await db.prepare(`SELECT s.* FROM task22_upload_files f
    JOIN task22_upload_sessions u ON u.id=f.session_id JOIN task22_shares s ON s.id=u.share_id
    WHERE f.id=?1 AND s.owner_kind='user' AND s.owner_ref=?2`).bind(id,owner).first();
  if (!row) throw new Task22Error('文件不存在或无权访问',404,'file_not_found');
  return row;
}

/** Version 1 contract for Task29/38/39/48. Handles contain IDs, never R2 keys.
 * Quota, identity, membership, grants and cleanup stay in Task14/22.
 * Only initializeAttachment creates new private resources. Existing public
 * shares/guests continue to use their original password/capability contracts. */
export const secureFilesV1=Object.freeze({
  version:1,
  async initializeAttachment(context,account,input) {
    requireUser(account);
    requireAllowedFields(input,new Set(['file_name','mime_type','size_bytes','minutes','max_downloads','idempotency_key']));
    const fileName=cleanFileName(input.file_name),mimeType=normalizeMime(input.mime_type);
    const sizeBytes=safeInteger(input.size_bytes,1,MAX_SHARE_BYTES,undefined,'文件大小');
    const db=context.env.WYJ_DB,storage=context.env.WYJ_STORAGE;
    const session=await createUploadSession(db,account,context.env,{
      total_bytes:sizeBytes,file_count:1,access_scope:'private',minutes:input.minutes,max_downloads:input.max_downloads,idempotency_key:input.idempotency_key,
    });
    try {
      const previous=await db.prepare('SELECT id,file_name,mime_type,size_bytes FROM task22_upload_files WHERE session_id=?1').bind(session.id).first();
      if(previous && (previous.file_name!==fileName || previous.mime_type!==mimeType || Number(previous.size_bytes)!==sizeBytes)) {
        throw new Task22Error('同一上传请求标识对应不同文件',409,'file_idempotency_conflict');
      }
      const file=previous?await db.prepare('SELECT * FROM task22_upload_files WHERE id=?1').bind(previous.id).first():await allocateUploadFile(db,account,context.env,{
        session_id:session.id,file_id:session.id,file_name:fileName,
        relative_path:fileName,mime_type:mimeType,size_bytes:sizeBytes,
      });
      return {version:1,source:'transfer',session_id:session.id,file_id:file.id,
        part_size:Number(file.part_size),part_count:Number(file.part_count),expires_at:session.expires_at,
        status_url:`/api/transfer/uploads/${session.id}`,complete_url:`/api/transfer/uploads/${session.id}/complete`,
        cancel_url:`/api/transfer/uploads/${session.id}/abort`,
        part_url:`/api/transfer/uploads/${session.id}/files/${file.id}/parts/{part_number}`};
    } catch(error) {
      // A conflicting replay must not cancel the owner's original upload.
      if(error.code!=='file_idempotency_conflict')await abortUploadSession(db,storage,account,{session_id:session.id}).catch(()=>undefined);
      throw error;
    }
  },
  async uploadPart(context,account,handle,partNumber) {
    requireUser(account);
    return await uploadPart(context.env.WYJ_DB,context.env.WYJ_STORAGE,account,context.request,
      handle.session_id,handle.file_id,partNumber,context.env.WYJ_ENVIRONMENT);
  },
  async resume(context,account,handle) {
    requireUser(account);
    return await uploadSessionState(context.env.WYJ_DB,account,{session_id:handle.session_id});
  },
  async complete(context,account,handle) {
    requireUser(account);
    return await completeUploadSession(context.env.WYJ_DB,context.env.WYJ_STORAGE,account,context.env,{session_id:handle.session_id});
  },
  async metadata(context,account,{source='transfer',file_id}) {
    const db=context.env.WYJ_DB,owner=requireUser(account);
    if (source==='temporary') {
      const row=await db.prepare("SELECT * FROM task14_shares WHERE id=?1 AND owner_user_id=?2 AND share_type='file'")
        .bind(cleanId(file_id),owner).first();
      if(!row || row.state!=='active' || Date.parse(row.expires_at)<=Date.now()) throw new Task22Error('文件不存在或已失效',404,'file_not_found');
      return {version:1,source,scope:'share',...filePayload(row)};
    }
    if(source!=='transfer') throw new Task22Error('文件来源无效',400,'file_source_invalid');
    const share=await ownedTransfer(db,account,file_id);
    if(!['active','delete_pending'].includes(share.state) || Date.parse(share.expires_at)<=Date.now()) throw new Task22Error('文件不存在或已失效',404,'file_not_found');
    const file=await db.prepare('SELECT * FROM task22_share_files WHERE share_id=?1 AND file_id=?2').bind(share.id,file_id).first();
    if(!file) throw new Task22Error('文件不存在',404,'file_not_found');
    return {version:1,source,scope:share.access_scope,...sharePayload(share,[file])};
  },
  async authorize(context,account,{source='transfer',file_id,password=''}) {
    await secureFilesV1.metadata(context,account,{source,file_id});
    if(source==='temporary') return await authorizeFileDownload(context.env.WYJ_DB,context.env.WYJ_STORAGE,context.env,{id:file_id,password});
    const share=await ownedTransfer(context.env.WYJ_DB,account,file_id);
    const result=await authorizeShareDownload(context.env.WYJ_DB,context.env.WYJ_STORAGE,context.env,{id:share.id,file_id,password},account,{
      sessionToken: task20TokenFromRequest(context.request),
    });
    return {...result,url:`/api/transfer/shares/${share.id}/download?file=${encodeURIComponent(file_id)}&grant=${encodeURIComponent(result.token)}`};
  },
  async revoke(context,account,{source='transfer',file_id}) {
    requireUser(account);
    if(source==='temporary') return await cancelFileReservation(context.env.WYJ_DB,context.env.WYJ_STORAGE,account,file_id);
    if(source!=='transfer') throw new Task22Error('文件来源无效',400,'file_source_invalid');
    const share=await ownedTransfer(context.env.WYJ_DB,account,file_id);
    return await revokeShare(context.env.WYJ_DB,context.env.WYJ_STORAGE,account,{id:share.id});
  },
});
