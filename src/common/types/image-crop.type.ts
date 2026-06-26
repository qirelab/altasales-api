export interface ImageCropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageCrop {
  x: number;
  y: number;
  zoom: number;
  croppedArea: ImageCropArea;
}
