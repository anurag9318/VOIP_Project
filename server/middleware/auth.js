import jwt from 'jsonwebtoken';
export function auth(req,res,next){try{const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):null;if(!token)return res.status(401).json({message:'Authentication required'});req.user=jwt.verify(token,process.env.JWT_SECRET);next()}catch{res.status(401).json({message:'Invalid or expired token'})}}
