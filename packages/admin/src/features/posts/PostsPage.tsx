import { useLocation, useParams } from "react-router-dom";
import { PostBriefCreatePage } from "./PostBriefCreatePage";
import { PostQueuePage } from "./PostQueuePage";
import { PostWorkPage } from "./PostWorkPage";

export function PostsPage() {
  const { workId, stage } = useParams();
  const location = useLocation();

  if (location.pathname === "/posts/new/brief") {
    return <PostBriefCreatePage />;
  }
  if (workId) {
    return <PostWorkPage workId={workId} stage={stage} />;
  }
  return <PostQueuePage />;
}
