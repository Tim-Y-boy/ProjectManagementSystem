<script setup lang="ts">
const props=defineProps<{reviews:any[];modelValue:any[]}>();
const emit=defineEmits<{'update:modelValue':[value:any[]]}>();
const item=(departmentId:number,index:number)=>props.modelValue.find(c=>c.departmentId===departmentId)?.items[index]||{answer:'',note:''};
function update(review:any,index:number,change:any){
 const current=props.modelValue.find(c=>c.departmentId===review.departmentId)||{departmentId:review.departmentId,items:review.checklist.map(()=>({answer:'',note:''}))};
 const next={...current,items:current.items.map((value:any,i:number)=>i===index?{...value,...change}:value)};
 emit('update:modelValue',[...props.modelValue.filter(c=>c.departmentId!==review.departmentId),next]);
}
</script>
<template>
 <section v-for="review in reviews" :key="review.departmentId" class="checklist">
  <h4>{{ review.departmentName }} · 审核清单</h4>
  <div v-for="(text,i) in review.checklist" :key="i" class="check-item">
   <p>{{ i+1 }}. {{ text }}</p>
   <el-radio-group :model-value="item(review.departmentId,i).answer" @update:model-value="answer=>update(review,i,{answer})"><el-radio value="yes">符合</el-radio><el-radio value="no">不符合</el-radio><el-radio value="na">不适用</el-radio></el-radio-group>
   <el-input :model-value="item(review.departmentId,i).note" @update:model-value="note=>update(review,i,{note})" :placeholder="item(review.departmentId,i).answer==='na'?'请填写不适用原因（必填）':'核验说明（选填）'" maxlength="2000" />
  </div>
 </section>
</template>
<style scoped>.checklist{margin:18px 0;padding:16px;background:var(--bg-base,#f7faf9);border-radius:8px}.check-item{padding:10px 0}p{font-size:14px;line-height:1.6;margin:0 0 8px}h4{margin:0}.el-input{margin-top:6px}</style>
