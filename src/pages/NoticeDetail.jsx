import React from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import useSWR from 'swr';
import noticesService from '../services/notices';
import { noticeKind, fmtDate, deadlineChip, daysLeftText, linkLabel, bodyPoints, isExternalNotice } from '../utils/notice';
import { safeHref } from '../utils/safeUrl';
import './NoticeDetail.css';

const NoticeDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { data, error, isLoading } = useSWR(id ? `notice_${id}` : null, () => noticesService.getNotice(id));
    const n = data?.notice;
    const dl = n?.deadline ? deadlineChip(n.deadline) : null;

    return (
        <div className="notice-detail">
            <div className="nd-header">
                <button className="nd-back" onClick={() => navigate(-1)} aria-label="Back to notices">
                    <ArrowLeft size={18} /> <span>Notices</span>
                </button>
            </div>

            {isLoading && <div className="nd-state">Loading…</div>}
            {error && <div className="nd-state">Couldn’t load this notice.</div>}

            {n && (
                <div className="nd-body-wrap">
                    <div className="nd-tags">
                        <span className={`home-notice-tag ${noticeKind(n).cls}`}>{noticeKind(n).label}</span>
                        {isExternalNotice(n) && <span className="home-notice-tag k-external">External</span>}
                        {n.audience && <span className="home-notice-badge">{n.audience}</span>}
                    </div>

                    <h1 className="nd-title">{n.title}</h1>

                    <div className="nd-meta">
                        {n.source && <div><span className="nd-meta-label">From</span> {n.source}</div>}
                        {n.published_at && <div><span className="nd-meta-label">Received</span> {fmtDate(n.published_at)}</div>}
                    </div>

                    {dl && (
                        <div className={`nd-deadline ${dl.cls}`}>
                            ⏰ Apply by {fmtDate(n.deadline)} · {daysLeftText(n.deadline)}
                        </div>
                    )}

                    {(() => {
                        // pass the CTA url so the same link is not offered twice
                        const points = bodyPoints(n.body, n.link);
                        if (!points.length) return null;
                        return (
                            <>
                                <div className="nd-section-label">Details</div>
                                <ul className="nd-points">
                                    {points.map((segs, i) => (
                                        <li key={i}>
                                            {segs.map((seg, j) => (seg.url ? (
                                                <a key={j} className="nd-inline-link" href={safeHref(seg.url)}
                                                    target="_blank" rel="noreferrer">{seg.label} ↗</a>
                                            ) : (
                                                <React.Fragment key={j}>{seg.text}</React.Fragment>
                                            )))}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        );
                    })()}

                    {n.link && (
                        <a className="nd-cta" href={safeHref(n.link)} target="_blank" rel="noreferrer">{linkLabel(n.link)} ↗</a>
                    )}
                </div>
            )}
        </div>
    );
};

export default NoticeDetail;
