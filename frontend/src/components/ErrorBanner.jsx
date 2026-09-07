import Icon from "./Icon";

export default function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div className="error-banner" role="alert">
      <Icon name="alert" size={16} />
      <p>{message}</p>
      <button type="button" className="error-dismiss" onClick={onDismiss}>
        <Icon name="close" size={15} />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  );
}
