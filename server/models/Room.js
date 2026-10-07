import mongoose from 'mongoose';
const schema=new mongoose.Schema({name:{type:String,required:true,trim:true},description:String,profileImage:String,owner:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},admins:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],members:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],isPrivate:{type:Boolean,default:true},passwordHash:String},{timestamps:true});
export default mongoose.model('Room',schema);
