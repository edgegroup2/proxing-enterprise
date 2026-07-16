exports.adaptiveTutor = async (req,res)=>{
   try{

      const {
        question,
        options,
        selected_answer,
        correct_answer,
        explanation,
        intent
      } = req.body;

      const aiResponse = await openai.chat.completions.create({
         ...
      });

      return res.json({
         success:true,
         data:parsedResponse
      });

   }catch(err){
      return res.status(500).json({
         success:false,
         message:"Tutor unavailable"
      });
   }
}
