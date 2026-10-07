import mongoose from 'mongoose';
const schema=new mongoose.Schema({sender:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},receiver:{type:mongoose.Schema.Types.ObjectId,ref:'User'},room:{type:mongoose.Schema.Types.ObjectId,ref:'Room'},message:{type:String,required:true,trim:true,maxlength:4000},messageType:{type:String,default:'text'},read:{type:Boolean,default:false}},{timestamps:true});
schema.index({sender:1,receiver:1,createdAt:-1}); schema.index({room:1,createdAt:-1});
export default mongoose.model('Message',schema);
