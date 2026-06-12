figma.showUI(__html__, {
  width: 450,
  height: 620
});

type CardKind = 'track' | 'album';

type ITunesTrack = {
  trackId?: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  trackViewUrl?: string;
  primaryGenreName?: string;
};

type CardData = {
  id?: string;
  kind: CardKind;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  releaseDate: string;
  genre: string;
  link: string;
};

type GenerateCardsMessage = {
  type: 'generate-cards';
  tracks?: CardData[];
  queries?: string[];
  country?: string;
};

// UI에서 선택한 곡/앨범 목록을 받아 현재 선택된 카드 템플릿에 복제 적용한다.
figma.ui.onmessage = async (msg: GenerateCardsMessage) => {
  if (msg.type !== 'generate-cards') return;

  try {
    const selectedItems = Array.isArray(msg.tracks) ? msg.tracks : [];
    const queries = Array.isArray(msg.queries) ? msg.queries : [];
    const country = msg.country || 'KR';

    if (!selectedItems.length && !queries.length) {
      figma.notify('곡이나 앨범을 하나 이상 추가해 주세요.');
      return;
    }

    const template = getSelectedTemplate();
    const cards: CardData[] = [...selectedItems];

    // 이전 textarea 기반 입력과도 호환되도록 query가 오면 첫 곡 검색 결과로 변환한다.
    for (const query of queries) {
      const track = await searchITunesTrack(query, country);

      if (track) {
        cards.push(track);
      } else {
        figma.notify(`검색 결과 없음: ${query}`);
      }
    }

    if (!cards.length) {
      figma.notify('생성할 카드가 없습니다.');
      return;
    }

    figma.notify(`${cards.length}개의 카드를 생성합니다.`);
    await createCardsFromTemplate(template, cards);
    figma.notify('카드 생성 완료!');
  } catch (error) {
    figma.notify(error instanceof Error ? error.message : '오류가 발생했습니다.');
  }
};

// query 호환용: 곡 검색 결과의 첫 항목을 카드 데이터로 변환한다.
async function searchITunesTrack(
  query: string,
  country: string
): Promise<CardData | null> {
  const params = new URLSearchParams({
    term: query,
    country,
    media: 'music',
    entity: 'song',
    limit: '5'
  });

  const response = await fetch(`https://itunes.apple.com/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error('iTunes API 요청에 실패했습니다.');
  }

  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    return null;
  }

  return trackToCardData(data.results[0] as ITunesTrack);
}

// iTunes 곡 응답을 Figma 템플릿 필드 이름에 맞는 공통 카드 데이터로 맞춘다.
function trackToCardData(item: ITunesTrack): CardData {
  return {
    id: item.trackId ? `track-${item.trackId}` : undefined,
    kind: 'track',
    title: item.trackName || '',
    artist: item.artistName || '',
    album: item.collectionName || '',
    coverUrl: item.artworkUrl100 ? getHighResArtwork(item.artworkUrl100) : '',
    releaseDate: formatDate(item.releaseDate),
    genre: item.primaryGenreName || '',
    link: item.trackViewUrl || ''
  };
}

// 100px iTunes 커버 URL을 카드에 쓰기 좋은 고해상도 이미지 URL로 바꾼다.
function getHighResArtwork(url: string): string {
  return url.replace('100x100bb.jpg', '600x600bb.jpg');
}

// iTunes 날짜 문자열을 카드에서 읽기 쉬운 YYYY-MM-DD 형태로 통일한다.
function formatDate(value?: string): string {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

// 선택된 템플릿 프레임을 복제한 뒤 약속된 레이어 이름에 텍스트와 이미지를 채운다.
async function createCardsFromTemplate(
  template: FrameNode,
  cards: CardData[]
) {
  const gap = 40;

  for (let i = 0; i < cards.length; i++) {
    const cardData = cards[i];

    const card = template.clone();
    card.name = `CARD_${i + 1}_${cardData.title}`;
    card.x = template.x + (template.width + gap) * (i + 1);
    card.y = template.y;

    const coverNode = findChildByName(card, 'cover_image');
    const bgNode = findChildByName(card, 'bg_image');
    const typeNode = findChildByName(card, 'kind_tag');
    const titleNode = findChildByName(card, 'track_title');
    const artistNode = findChildByName(card, 'artist_name');
    const releaseNode = findChildByName(card, 'release_date');
    const albumNode = findChildByName(card, 'album_name');
    const genreNode = findChildByName(card, 'genre_tag');

    await setImageFill(coverNode, cardData.coverUrl);
    await setImageFill(bgNode, cardData.coverUrl);
    await setText(typeNode, formatKind(cardData.kind));
    await setText(titleNode, cardData.title);
    await setText(artistNode, cardData.artist);
    await setText(releaseNode, cardData.releaseDate);
    await setText(albumNode, cardData.album);
    await setText(genreNode, cardData.genre);
  }
}

// 사용자가 카드 원본으로 쓸 프레임 하나를 선택했는지 확인한다.
function getSelectedTemplate(): FrameNode {
  const selection = figma.currentPage.selection;

  if (selection.length !== 1 || selection[0].type !== 'FRAME') {
    throw new Error('카드 템플릿 프레임 하나를 선택해 주세요.');
  }

  return selection[0] as FrameNode;
}

// 템플릿 내부에서 정해진 이름의 레이어를 찾아 카드 필드와 연결한다.
function findChildByName(parent: SceneNode, name: string): SceneNode | null {
  if ('findOne' in parent) {
    return parent.findOne((node) => node.name === name);
  }

  return null;
}

// 텍스트 노드는 폰트를 먼저 로드해야 characters 값을 안전하게 바꿀 수 있다.
function formatKind(kind: CardKind): string {
  return kind === 'album' ? 'ALBUM' : 'TRACK';
}

async function setText(node: SceneNode | null, value: string) {
  if (!node || node.type !== 'TEXT') return;

  await figma.loadFontAsync(node.fontName as FontName);
  node.characters = value || '';
}

// 이미지 URL을 받아 Figma 이미지 리소스로 만든 뒤 대상 노드의 fill에 적용한다.
async function setImageFill(node: SceneNode | null, imageUrl: string) {
  if (!node || !imageUrl || !('fills' in node)) return;

  const imageResponse = await fetch(imageUrl);

  if (!imageResponse.ok) {
    throw new Error('앨범 커버 이미지를 가져오지 못했습니다.');
  }

  const imageBytes = await imageResponse.arrayBuffer();
  const image = figma.createImage(new Uint8Array(imageBytes));

  node.fills = [
    {
      type: 'IMAGE',
      scaleMode: 'FILL',
      imageHash: image.hash
    }
  ];
}
