// ServiceM8 API connection test — X-API-Key header
// Run with: node servicem8-test.js

const API_KEY  = 'smk-aa87cc-9a9a0a802a22e535-394394c0f2a1d836';
const ENDPOINT = 'https://api.servicem8.com/api_1.0/job.json';

fetch(ENDPOINT, {
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
})
  .then(res => {
    console.log('HTTP status:', res.status, res.statusText);
    if (!res.ok) return res.text().then(body => { throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 300)}`); });
    return res.json();
  })
  .then(jobs => {
    console.log(`Total jobs returned: ${jobs.length}\n`);

    jobs.slice(0, 3).forEach((job, i) => {
      console.log(`--- Job ${i + 1} ---`);
      console.log('  uuid:          ', job.uuid);
      console.log('  status:        ', job.status);
      console.log('  job_address:   ', job.job_address);
      console.log('  total_amount:  ', job.total_amount);
      console.log('  date:          ', job.date);
      console.log('  generated_job_id:', job.generated_job_id);
      console.log('  full object:\n', JSON.stringify(job, null, 4));
      console.log();
    });
  })
  .catch(err => console.error('Error:', err.message));
