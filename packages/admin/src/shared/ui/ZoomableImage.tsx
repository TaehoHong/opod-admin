import { Image, Modal, UnstyledButton, type ImageProps } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState, type CSSProperties } from "react";
import classes from "./ZoomableImage.module.css";

// 운영자는 생성된 이미지를 크게 봐야 채택 여부를 판단할 수 있는데 목록의
// 썸네일은 작다. 클릭하면 라이트박스로 확대해서 본다 — 닫기 버튼, 배경 클릭,
// Esc로 닫는다 (Mantine Modal 기본 동작).
//
// 이미지 클릭이 이미 다른 결정을 뜻하는 자리(생성 화면의 후보 선택)에서는
// 이미지를 감싸지 말고 ImageLightbox를 별도 컨트롤로 열어 준다. 확대와 선택이
// 같은 클릭을 두고 다투면 둘 다 못 쓴다.

/** 원본 위에 겹쳐 비교할 이미지. 있으면 라이트박스가 비교 모드로 열린다. */
export type CompareSource = {
  src: string;
  /** 오른쪽(겹치는 쪽) 배지 문구. */
  label: string;
  /** 왼쪽(바탕) 배지 문구. */
  baseLabel: string;
};

type ZoomableImageProps = Omit<ImageProps, "src" | "alt"> & {
  src: string;
  alt: string;
  /** 버튼의 접근 가능한 이름. 기본은 `${alt} 크게 보기`. */
  zoomLabel?: string;
  /** 확대할 때 보여줄 이미지. 썸네일과 다를 때만 준다(기본은 src). */
  zoomSrc?: string;
  compare?: CompareSource;
};

export function ZoomableImage({
  src,
  alt,
  zoomLabel,
  zoomSrc,
  compare,
  ...imageProps
}: ZoomableImageProps) {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <UnstyledButton
        className={classes.trigger}
        // 크기를 지정한 썸네일은 버튼도 같은 크기여야 줄 배치가 깨지지 않고,
        // 지정하지 않은 경우에는 원래처럼 칸을 채운다.
        w={imageProps.w ?? "100%"}
        aria-label={zoomLabel ?? `${alt} 크게 보기`}
        onClick={open}
      >
        <Image src={src} alt={alt} {...imageProps} />
      </UnstyledButton>
      <ImageLightbox
        opened={opened}
        onClose={close}
        src={zoomSrc ?? src}
        alt={alt}
        {...(compare ? { compare } : {})}
      />
    </>
  );
}

export function ImageLightbox({
  opened,
  onClose,
  src,
  alt,
  compare,
}: {
  opened: boolean;
  onClose: () => void;
  src: string;
  alt: string;
  compare?: CompareSource;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={compare ? `${alt} · ${compare.baseLabel}/${compare.label}` : alt}
      size="auto"
      centered
      // 게시글 상세처럼 modal 안에서 열릴 수 있어 기본 modal(200)보다 위에 둔다.
      zIndex={400}
    >
      {compare ? (
        <CompareView src={src} alt={alt} compare={compare} />
      ) : (
        <Image
          src={src}
          alt={alt}
          fit="contain"
          w="auto"
          h="auto"
          className={classes.zoomed}
        />
      )}
    </Modal>
  );
}

// 원본과 마감본을 같은 자리에 겹쳐 두고 경계를 끌어 비교한다. 마감본을 받지
// 못하면 비교할 것이 없으므로 원본 단독 보기로 내려간다.
function CompareView({
  src,
  alt,
  compare,
}: {
  src: string;
  alt: string;
  compare: CompareSource;
}) {
  const [position, setPosition] = useState(50);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  if (state === "failed") {
    return (
      <Image
        src={src}
        alt={alt}
        fit="contain"
        w="auto"
        h="auto"
        className={classes.zoomed}
      />
    );
  }

  return (
    <div
      className={`${classes.compare} ${state === "loading" ? classes.loading : ""}`}
      style={{ "--x": `${position}%` } as CSSProperties}
    >
      <img className={classes.zoomed} src={src} alt={alt} />
      <div className={classes.after}>
        <img
          src={compare.src}
          alt={`${alt} ${compare.label}`}
          onLoad={() => setState("ready")}
          onError={() => setState("failed")}
        />
      </div>
      <div className={classes.divider} />
      <span className={`${classes.badge} ${classes.badgeLeft}`}>
        {compare.baseLabel}
      </span>
      <span className={`${classes.badge} ${classes.badgeRight}`}>
        {state === "loading" ? "마감 불러오는 중…" : compare.label}
      </span>
      <input
        className={classes.range}
        type="range"
        min={0}
        max={100}
        value={position}
        aria-label={`${compare.baseLabel}/${compare.label} 비교 슬라이더`}
        onChange={(event) => setPosition(Number(event.currentTarget.value))}
      />
    </div>
  );
}
