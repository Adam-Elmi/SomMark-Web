import { HTML } from "sommark";
import { getMetadata, getHeadings, glob } from "sommark-web/variables";

const mapper = HTML.clone();
mapper.register(["Metadata", "metadata"], () => "", { rules: { is_self_closing: true } });

export default {
  mapperFile: mapper,
  variables: {
    __pagesDir: "src/pages",
    glob,
    getMetadata,
    getHeadings,
  },
}
