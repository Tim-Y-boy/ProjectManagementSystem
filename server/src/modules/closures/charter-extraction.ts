import { BadRequestException } from '@nestjs/common';
import { CharterSource } from './charter-analysis-model';
import { dirname, join, sep } from 'path';

export async function extractCharter(buffer:Buffer,name:string,fileId:number):Promise<CharterSource[]> {
  if(!buffer.length||buffer.length>50*1024*1024)throw new BadRequestException('立项书须为非空文件且不超过 50MB');
  const result:CharterSource[]=[];
  const add=(text:string,anchor:string,label:string)=>{
    const normalized=text.replace(/\u0000/g,'').trim();
    for(let start=0;start<normalized.length;start+=6000)result.push({id:`f${fileId}:${anchor}:${start/6000+1}`,label:`${name} · ${label}${normalized.length>6000?`（片段${start/6000+1}）`:''}`,text:normalized.slice(start,start+6000)});
  };
  if(/\.pdf$/i.test(name)&&buffer.subarray(0,5).toString()==='%PDF-') {
    // Keep native import: the server compiles to CommonJS, while pdf.js is ESM.
    const pdfjs=await (new Function('return import("pdfjs-dist/legacy/build/pdf.mjs")'))();
    const base=dirname(require.resolve('pdfjs-dist/package.json'));
    const task=pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false,standardFontDataUrl:join(base,'standard_fonts')+sep,cMapUrl:join(base,'cmaps')+sep,cMapPacked:true});
    try {
      const pdf=await task.promise;
      if(pdf.numPages>150)throw new BadRequestException('立项书超过 150 页，请拆分后解析或手工填写');
      for(let page=1;page<=pdf.numPages;page++) {
        const content=await (await pdf.getPage(page)).getTextContent();
        const text=content.items.map((item:any)=>item.str+(item.hasEOL?'\n':' ')).join('');
        add(text,`page${page}`,`第 ${page} 页`);
      }
    } finally {await task.destroy();}
  } else if(/\.docx$/i.test(name)&&buffer.subarray(0,2).toString()==='PK') {
    // Central-directory sizes are checked before decompression; no embedded file or external resource is opened.
    let expanded=0,entries=0,documentFound=false;
    for(let i=0;i+46<=buffer.length;i++)if(buffer.readUInt32LE(i)===0x02014b50) {
      const size=buffer.readUInt32LE(i+24),nameLength=buffer.readUInt16LE(i+28);
      expanded+=size;entries++;
      if(buffer.subarray(i+46,i+46+nameLength).toString()==='word/document.xml')documentFound=true;
      if(expanded>100*1024*1024||entries>5000)throw new BadRequestException('DOCX 解压内容过大，请拆分或手工填写');
    }
    if(!documentFound)throw new BadRequestException('文件内容不是有效 DOCX');
    const mammoth=require('mammoth');
    const {value}=await mammoth.extractRawText({buffer});
    String(value).split(/\n\s*\n/).forEach((text,index)=>add(text,`paragraph${index+1}`,`段落/表格文本 ${index+1}`));
  } else throw new BadRequestException('自动解析仅支持文字 PDF、DOCX；请转换文件或手工填写');
  const length=result.reduce((n,s)=>n+s.text.length,0);
  if(length<20)throw new BadRequestException('未提取到足够文字，可能为扫描件；请手工填写或提供文字版 PDF/DOCX');
  if(length>180000)throw new BadRequestException('报告文字超过解析上限，请拆分文件或手工填写');
  return result;
}
