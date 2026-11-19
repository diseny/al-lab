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
let minimumCount = 5;
function count(n) {
  assert(Number.isInteger(n) && n >= minimumCount);
}
function fraction(rate) {
  assert(typeof rate === 'number' && rate >= 0 && rate <= 1);
}
function courseStats(stats, keys, overall) {
  shape(stats, keys);
  if (stats.n === null) {
    assert.equal(stats.outside, null);
    assert.equal(stats.cases.length, 0);
    assert.equal(stats.courses.length, 0);
  } else {
    count(stats.n);
    if (stats.outside !== null) fraction(stats.outside);
  }
  assert(Array.isArray(stats.cases) && stats.cases.length <= 3);
  if (stats.outside !== null && stats.stage !== 1) {
    assert.equal(stats.cases.length, Math.min(stats.n, 3));
  }
  for (const courseNames of stats.cases) {
    assert(Array.isArray(courseNames) && courseNames.length > 0);
    for (const course of courseNames) {
      shape(course, 'title outside');
      assert(typeof course.title === 'string' && course.title.trim().length > 0);
      assert(typeof course.outside === 'boolean');
      assert(!/\b(?:R_[a-f0-9]{20}|20[12]\d\d{4,})\b/i.test(course.title));
    }
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
    minimumCount = ['학부 전체', '대학 전체', '세부전공 미기록'].includes(group.label) ? 5 : 1;
    count(group.n);
    assert.equal(group.terms.length, 4);
    assert.equal(group.links.length, 3);
    const termCodes = group.terms.map(term => {
      minimumCount = ['학부 전체', '대학 전체', '세부전공 미기록'].includes(group.label) ? (term.stage >= 3 ? 2 : 5) : 1;
      courseStats(term, 'stage n outside courses cases profiles', true);
      if (term.stage === 1) assert.equal(term.cases.length, 0);
      shape(term.profiles, 'high low');
      const codes = new Set(term.courses.map(c => c.code));
      for (const band of Object.values(term.profiles)) {
        courseStats(band, 'n outside courses cases', false);
        if (term.stage === 1) assert.equal(band.cases.length, 0);
        for (const c of band.courses) assert(codes.has(c.code));
      }
      return codes;
    });
    group.links.forEach((link, index) => {
      minimumCount = index === 2 && ['학부 전체', '대학 전체', '세부전공 미기록'].includes(group.label) ? 2 : (['학부 전체', '대학 전체', '세부전공 미기록'].includes(group.label) ? 5 : 1);
      const endpoints = termCodes.slice(index, index + 2);
      connections(link, 'from paired edges profiles', ...endpoints);
      shape(link.profiles, 'high low');
      for (const [name, band] of Object.entries(link.profiles)) {
        connections(band, 'paired edges', ...endpoints);
        const source = new Set(group.terms[index].profiles[name].courses.map(c => c.code));
        const target = new Set(group.terms[index + 1].profiles[name].courses.map(c => c.code));
        for (const edge of band.edges) {
          assert(source.has(edge.code_from), 'Connected source must show its enrollment rate');
          assert(target.has(edge.code_to), 'Connected destination must show its enrollment rate');
        }
      }
    });
  }
}
console.log('PASS: course network contains approved aggregates and course-title cases with classification flags.');
const networks = embedded('course_paths.html', 'network-data');
for (const page of networks) {
  shape(page, 'unit groups');
  for (const group of page.groups) {
    shape(group, 'label terms');
    for (const term of group.terms) {
      shape(term, 'stage n nodes edges');
      assert(term.nodes.length <= 50);
      const codes = new Set(term.nodes.map(n => n.code));
      const connected = new Set(term.edges.flatMap(e => [e.source, e.target]));
      const communities = new Map();
      for (const node of term.nodes) {
        shape(node, 'code title n x y strength community');
        assert(Number.isInteger(node.n) && node.n >= 3 && node.n <= term.n);
        assert(Number.isFinite(node.x) && Number.isFinite(node.y));
        if (node.community !== null) {
          assert(Number.isInteger(node.community) && node.community > 0 && connected.has(node.code));
          communities.set(node.community, (communities.get(node.community) || 0) + 1);
        }
      }
      for (const size of communities.values()) assert(size >= 2);
      for (const edge of term.edges) {
        shape(edge, 'source target n weight');
        assert(codes.has(edge.source) && codes.has(edge.target));
        assert(Number.isInteger(edge.n) && edge.n >= 3 && edge.n <= term.n);
        assert(Math.abs(edge.weight - edge.n / term.n) < 1e-8);
      }
    }
  }
}
console.log('PASS: network aggregate schema and community membership.');
const readings = embedded('course_paths.html', 'flow-reading-data');
assert.equal(readings.length, 3);
for (const page of readings) {
  shape(page, 'unit groups');
  for (const group of page.groups) {
    shape(group, 'label summary context');
    assert(typeof group.summary === 'string' && group.summary.length > 0);
    assert(typeof group.context === 'string' && group.context.length > 0);
  }
}
for (const page of [...pages, ...networks]) {
  const reading = readings.find(r => r.unit === page.unit);
  assert(reading);
  for (const group of page.groups) assert(reading.groups.some(r => r.label === group.label));
}
console.log('PASS: all faculties and groups have whole-period interpretations.');
