import mongoose from 'mongoose';
const schema=new mongoose.Schema({caller:{type:mongoose.Schema.Types.ObjectId,ref:'User'},participants:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],room:{type:mongoose.Schema.Types.ObjectId,ref:'Room'},callType:{type:String,enum:['voice','video'],required:true},status:{type:String,enum:['ringing','accepted','rejected','missed','ended'],default:'ringing'},startedAt:Date,endedAt:Date,duration:{type:Number,default:0}},{timestamps:true});
export default mongoose.model('Call',schema);
