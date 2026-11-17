const fs=require('fs'),path=require('path'),assert=require('assert');const root=__dirname,data=JSON.parse(fs.readFileSync(path.join(root,'data.json'),'utf8'));
assert.equal(data.privacy.individualRecords,false);assert.equal(data.privacy.minimumCellSize,5);assert.equal(data.views.length,6);
function inspect(value){if(Array.isArray(value))return value.forEach(inspect);if(!value||typeof value!=='object')return;for(const [k,v] of Object.entries(value)){assert(!['research_id','student_id','raw_title','rows','courses','current_major'].includes(k),'Forbidden individual field: '+k);inspect(v);}}
inspect(data);for(const view of data.views){for(const stage of view.stages){for(const mode of ['all','reduced']){const cells=stage[mode].cells;assert(cells.every(c=>c.n>=5));assert.equal(cells.reduce((s,c)=>s+c.n,0),stage.n);assert(stage[mode].overlap==null||stage[mode].overlap>=0&&stage[mode].overlap<=1);}}for(const stage of view.submajors)for(const group of stage.groups){assert(group.n==null||group.n>=5);assert(group.mean==null||group.mean>=0&&group.mean<=1);assert(group.topOutside.every(c=>c.n==null?c.rate===null:c.n>=5&&Math.abs(c.rate-c.n/group.n)<1e-10));if(group.mean>0)assert(group.topOutside.length>0,'Outside-course names must not disappear when the mismatch rate is positive.');}}
for(const name of fs.readdirSync(root))assert(!/\.(xlsx?|csv|rds|RData|Rhistory)$/i.test(name));
new (require('vm').Script)(fs.readFileSync(path.join(root,'app.js'),'utf8'));console.log('PASS: aggregate-only schema, minimum cell sizes, statistical bounds, file boundary, JavaScript syntax.');
function embedded(file, id) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(!/\b(topOutside|research_id|student_id)\b|번 학생/.test(html));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  new (require('vm').Script)(scripts[0][1]);
  const marker = '<script type="application/json" id="' + id + '">';
  assert.equal(html.split(marker).length, 2);
  return JSON.parse(html.split(marker)[1].split('</script>')[0]);
}
function shape(value, fields) {
  assert.deepStrictEqual(Object.keys(value).sort(), fields.split(' ').sort());
}
function count(n) {
  assert(Number.isInteger(n) && n >= 5);
}
function fraction(rate) {
  assert(typeof rate === 'number' && rate >= 0 && rate <= 1);
}
function courseStats(stats, keys, overall) {
  shape(stats, keys);
  if (stats.n === null) {
    assert.equal(stats.outside, null);
    assert.equal(stats.courses.length, 0);
  } else {
    count(stats.n);
    if (stats.outside !== null) fraction(stats.outside);
  }
  assert(stats.courses.length <= 15);
  for (const course of stats.courses) {
    shape(course, overall ? 'code n title rate offered supplemental keyword_match listed' : 'code n rate');
    count(course.n);
    assert(course.n <= stats.n);
    fraction(course.rate);
    assert(Math.abs(course.rate - course.n / stats.n) < 1e-9);
  }
}
function connections(link, keys, left, right) {
  shape(link, keys);
  if (link.paired === null) assert.equal(link.edges.length, 0);
  else count(link.paired);
  for (const edge of link.edges) {
    shape(edge, 'code_from code_to n base rate');
    count(edge.n);
    count(edge.base);
    assert(edge.n <= edge.base && edge.base <= link.paired);
    assert(left.has(edge.code_from) && right.has(edge.code_to));
    fraction(edge.rate);
    assert(Math.abs(edge.rate - edge.n / edge.base) < 1e-9);
  }
}
const pages = embedded('course_paths.html', 'data');
assert.equal(pages.length, 3);
for (const page of pages) {
  shape(page, 'unit showMajors cutoff groups');
  assert.equal(page.cutoff, 3);
  for (const group of page.groups) {
    shape(group, 'label n terms links');
    count(group.n);
    assert.equal(group.terms.length, 4);
    assert.equal(group.links.length, 3);
    const termCodes = group.terms.map(term => {
      courseStats(term, 'stage n outside courses profiles', true);
      shape(term.profiles, 'high low');
      const codes = new Set(term.courses.map(c => c.code));
      for (const band of Object.values(term.profiles)) {
        courseStats(band, 'n outside courses', false);
        for (const c of band.courses) assert(codes.has(c.code));
      }
      return codes;
    });
    group.links.forEach((link, index) => {
      const endpoints = termCodes.slice(index, index + 2);
      connections(link, 'from paired edges profiles', ...endpoints);
      shape(link.profiles, 'high low');
      for (const band of Object.values(link.profiles)) connections(band, 'paired edges', ...endpoints);
    });
  }
}
console.log('PASS: course network contains only approved aggregate fields.');
