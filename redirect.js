(function(){
  var p = location.pathname, m = p.match(/^\/([^\/]+)(\/.*)?$/), seg = m ? m[1] : "", rest = m ? (m[2] || "/") : "/";
  var research = {"grounded":"grounded-chi-five.vercel.app","ehs-osha-analysis":"ehs-osha-analysis.vercel.app","ehs-ai-grounding-eval":"ehs-ai-grounding-eval.vercel.app","ehs-human-factors-ontology":"ehs-human-factors-ontology.vercel.app","ehs-risk-sem":"ehs-risk-sem.vercel.app"};
  var projects = {"ehs-benchmarks":1,"ehs-capitals-calculator":1,"ehs-chemical-peers":1};
  var url = research[seg] ? "https://" + research[seg] + rest
          : projects[seg] ? "https://priyatham-projects.vercel.app" + p
          : "https://priyatham-personal-site.vercel.app" + p;
  location.replace(url + location.search + location.hash);
})();
