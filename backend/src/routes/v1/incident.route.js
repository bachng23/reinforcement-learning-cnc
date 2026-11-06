const router = require('express').Router();
const db = require('../../config/prisma');
const { requireAuth } = require('../../middlewares/auth.middleware');
const { accessError } = require('../../services/factory-access.service');
const { parse } = require('../../services/incident-policy');
const service = require('../../services/incident.service');
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use(requireAuth);
router.get('/',async(req,res)=>res.json(await service.listIncidents(db,req.user,req.query)));
router.get('/summary',async(req,res)=>res.json(await service.counts(db,req.user,req.query)));
router.get('/:id',async(req,res)=>{parse(service.empty,req.query);res.json(await service.getIncident(db,req.user,req.params.id));});
for(const kind of ['events','occurrences'])router.get(`/:id/${kind}`,async(req,res)=>res.json(await service.history(db,req.user,req.params.id,req.query,kind)));
for(const [method,path,operation] of [['post','/','report'],['post','/:id/commands','command'],['post','/:id/links','link'],['delete','/:id/links/:link_id','unlink']]) {
  router[method](path,async(req,res)=>{
    parse(service.empty,req.query);
    const result=await service.writeIncident(db,req.user,operation,req.params.id,req.body,req.get('Idempotency-Key'),req.params.link_id);
    if(result.replayed)res.set('Idempotency-Replayed','true');
    if(operation==='report')res.set('Location',`/api/v1/incidents/${result.body.data.incident.id}`);
    res.status(result.status).json(result.body);
  });
}
router.use((raw,req,res,_next)=>{
  const error=accessError(raw),known={UNAUTHORIZED:401,FORBIDDEN:403};
  const status=error.statusCode??known[error.message]??500;
  res.status(status).json({success:false,error:{code:error.statusCode?error.code:known[error.message]?error.message:'INCIDENT_INTERNAL_ERROR',
    message:status>=500?'Incident service or evidence is unavailable':error.statusCode?error.message:'Authentication or permission is required'},requestId:req.requestId});
});
module.exports=router;
