import mongoose from 'mongoose';
const schema=new mongoose.Schema({fullName:{type:String,required:true,trim:true},username:{type:String,required:true,unique:true,index:true,trim:true},email:{type:String,required:true,unique:true,index:true,lowercase:true,trim:true},passwordHash:{type:String,required:true},profilePicture:String,status:{type:String,default:'offline'},lastSeen:Date},{timestamps:true});
export default mongoose.model('User',schema);
