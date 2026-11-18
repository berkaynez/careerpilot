import { createSourceReader } from '../discovery/sources.js';
import type { Source, SourceReader } from '../discovery/sources.js';
import { normalizeRole } from '../discovery/role-profiles.js';
import type { SearchRow } from './search.js';

export const employers: Source[] = [
  {provider:'lever',board:'dreamgames',company:'Dream Games'},
  {provider:'greenhouse',board:'goodjobgames',company:'Good Job Games'},
  {provider:'lever',board:'trendyol',company:'Trendyol'},
  {provider:'lever',board:'getmidas',company:'Midas'},
  {provider:'lever',board:'insiderone',company:'Insider One'},
  {provider:'lever',board:'peakgames',company:'Peak'},
];

export function employerFeeds(reader: SourceReader = createSourceReader()) {
  async function collect() {
    return Promise.all(employers.map(async source=>{
      try {
        const {jobs,rejected}=await reader(source,AbortSignal.timeout(40_000));
        const rows:SearchRow[]=jobs.map(job=>{
          const location=normalizeRole(job.location);
          const inTurkey=/\b(istanbul|turkey|turkiye|ankara|izmir)\b/.test(location);
          const mode=job.remote?'remote':job.workMode || location.match(/\b(hybrid|onsite|on site)\b/)?.[0] || '';
          return {title:job.title,company:source.company,sourceName:source.company,description:job.text,
            public_slug:source.board+'-'+job.externalId,employerUrl:job.url,location:job.location,
            countries:job.country?[job.country]:inTurkey?['TR']:[],work_mode:mode};
        });
        return {source:source.company,examined:jobs.length+rejected,rows,ok:true};
      } catch { return {source:source.company,examined:0,rows:[],ok:false}; }
    }));
  }
  let cached:ReturnType<typeof collect>|undefined;
  let expires=0;
  return ()=>{
    if (!cached || Date.now()>=expires) {
      expires=Date.now()+5*60_000;
      cached=collect();
    }
    return cached;
  };
}
